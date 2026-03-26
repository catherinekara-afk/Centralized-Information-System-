import argparse
import json
import os
import sqlite3
from datetime import datetime

from werkzeug.security import generate_password_hash

from app import init_db, app as flask_app


ALLOWED_ROLES = {"student", "staff", "admin"}


def connect_db(path):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def ensure_schema(target_path):
    flask_app.config["DATABASE"] = target_path
    init_db()


def load_target_email_map(conn):
    cur = conn.cursor()
    cur.execute("SELECT id, email FROM users")
    return {row["email"].lower(): row["id"] for row in cur.fetchall()}


def user_exists(conn, email):
    cur = conn.cursor()
    cur.execute("SELECT id FROM users WHERE LOWER(email) = ?", (email.lower(),))
    row = cur.fetchone()
    return row["id"] if row else None


def insert_user(conn, user, password_hash, approved=1, requested_role=None, approved_by=None, approved_at=None):
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO users (email, password_hash, name, role, disabled, approved, approved_at, approved_by, requested_role)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            user["email"],
            password_hash,
            user["name"],
            user["role"],
            user.get("disabled", 0),
            approved,
            approved_at,
            approved_by,
            requested_role or user["role"],
        ),
    )
    return cur.lastrowid


def insert_student_data(conn, user_id, fee_balance=0, attendance="", grades=None):
    cur = conn.cursor()
    cur.execute("SELECT id FROM student_data WHERE user_id = ?", (user_id,))
    if cur.fetchone():
        return False
    cur.execute(
        """
        INSERT INTO student_data (user_id, fee_balance, attendance, grades)
        VALUES (?, ?, ?, ?)
        """,
        (
            user_id,
            fee_balance or 0,
            attendance or "",
            json.dumps(grades or {}),
        ),
    )
    return True


def import_from_db(source_path, target_conn, default_approved=True):
    src_conn = connect_db(source_path)
    src_cur = src_conn.cursor()

    src_cur.execute("PRAGMA table_info(users)")
    src_cols = {row["name"] for row in src_cur.fetchall()}

    src_cur.execute("SELECT * FROM users")
    rows = [dict(r) for r in src_cur.fetchall()]

    inserted = 0
    skipped = 0
    student_data_added = 0

    for row in rows:
        email = (row.get("email") or "").lower().strip()
        if not email:
            continue
        if row.get("role") not in ALLOWED_ROLES:
            continue

        existing_id = user_exists(target_conn, email)
        if existing_id:
            skipped += 1
            continue

        approved = row.get("approved", 1 if default_approved else 0) if "approved" in src_cols else 1
        requested_role = row.get("requested_role") if "requested_role" in src_cols else row.get("role")
        approved_at = row.get("approved_at") if "approved_at" in src_cols else None
        approved_by = row.get("approved_by") if "approved_by" in src_cols else None

        user = {
            "email": email,
            "name": row.get("name") or email,
            "role": row.get("role"),
            "disabled": row.get("disabled", 0),
        }
        password_hash = row.get("password_hash")
        if not password_hash:
            password_hash = generate_password_hash("TempPassword123!")

        new_id = insert_user(
            target_conn,
            user,
            password_hash=password_hash,
            approved=approved,
            requested_role=requested_role,
            approved_by=approved_by,
            approved_at=approved_at,
        )
        inserted += 1

        # Student data
        if row.get("role") == "student":
            src_cur.execute("SELECT * FROM student_data WHERE user_id = ?", (row.get("id"),))
            sd = src_cur.fetchone()
            if sd:
                sd = dict(sd)
                added = insert_student_data(
                    target_conn,
                    new_id,
                    fee_balance=sd.get("fee_balance", 0),
                    attendance=sd.get("attendance", ""),
                    grades=json.loads(sd.get("grades") or "{}"),
                )
                if added:
                    student_data_added += 1

    target_conn.commit()
    src_conn.close()
    return inserted, skipped, student_data_added


def load_localstorage_users(json_path):
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict) and "demo_users" in data:
        return data["demo_users"]
    if isinstance(data, list):
        return data
    raise ValueError("Unsupported JSON format. Provide a list or an object with demo_users.")


def import_from_json(json_path, target_conn, default_password):
    users = load_localstorage_users(json_path)
    inserted = 0
    skipped = 0
    student_data_added = 0
    now = datetime.utcnow().isoformat()

    for u in users:
        email = (u.get("email") or "").lower().strip()
        role = u.get("role")
        if not email or role not in ALLOWED_ROLES:
            continue

        existing_id = user_exists(target_conn, email)
        if existing_id:
            skipped += 1
            continue

        user = {
            "email": email,
            "name": u.get("name") or email,
            "role": role,
            "disabled": 1 if u.get("disabled") else 0,
        }
        password_hash = generate_password_hash(default_password)
        new_id = insert_user(
            target_conn,
            user,
            password_hash=password_hash,
            approved=1,
            requested_role=role,
            approved_by=None,
            approved_at=now,
        )
        inserted += 1

        if role == "student":
            sd = u.get("studentData") or {}
            added = insert_student_data(
                target_conn,
                new_id,
                fee_balance=sd.get("feeBalance", 0),
                attendance=sd.get("attendance", ""),
                grades=sd.get("grades", {}),
            )
            if added:
                student_data_added += 1

    target_conn.commit()
    return inserted, skipped, student_data_added


def main():
    parser = argparse.ArgumentParser(description="Import users into student_management.db")
    parser.add_argument("--target", default=os.path.join(os.path.dirname(__file__), "student_management.db"))
    parser.add_argument("--from-db", action="append", default=[])
    parser.add_argument("--from-json", action="append", default=[])
    parser.add_argument("--default-password", default="TempPassword123!")
    args = parser.parse_args()

    target_path = os.path.abspath(args.target)
    ensure_schema(target_path)
    target_conn = connect_db(target_path)

    total_inserted = 0
    total_skipped = 0
    total_student_data = 0

    for db_path in args.from_db:
        db_path = os.path.abspath(db_path)
        if not os.path.exists(db_path):
            print(f"Skip missing DB: {db_path}")
            continue
        print(f"Importing from DB: {db_path}")
        ins, skip, sd = import_from_db(db_path, target_conn)
        total_inserted += ins
        total_skipped += skip
        total_student_data += sd

    for json_path in args.from_json:
        json_path = os.path.abspath(json_path)
        if not os.path.exists(json_path):
            print(f"Skip missing JSON: {json_path}")
            continue
        print(f"Importing from JSON: {json_path}")
        ins, skip, sd = import_from_json(json_path, target_conn, args.default_password)
        total_inserted += ins
        total_skipped += skip
        total_student_data += sd

    target_conn.close()

    print("Import complete")
    print(f"Inserted users: {total_inserted}")
    print(f"Skipped existing users: {total_skipped}")
    print(f"Student data rows added: {total_student_data}")
    if args.from_json:
        print(f"Default password set for JSON imports: {args.default_password}")


if __name__ == "__main__":
    main()

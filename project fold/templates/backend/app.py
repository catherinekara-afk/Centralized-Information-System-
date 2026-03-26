"""
Student Management System - Backend API
Flask-based REST API for managing students, staff, classes, and administration
"""

try:
    from flask import Flask, request, jsonify, send_from_directory, send_file, g
    from functools import wraps
except ImportError:
    print("Error: Flask is not installed.\nInstall dependencies with: pip install -r requirements.txt")
    raise

from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, timedelta
import sqlite3
import json
import os
import jwt

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-secret-change-me')

# Always use the database in the backend directory (or DATABASE_PATH if set)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DB = os.path.join(BASE_DIR, 'student_management.db')
DB_PATH = os.getenv('DATABASE_PATH', DEFAULT_DB)
DB_DIR = os.path.dirname(DB_PATH)
if DB_DIR and not os.path.exists(DB_DIR):
    os.makedirs(DB_DIR, exist_ok=True)
app.config['DATABASE'] = DB_PATH

# Determine where to serve static files from
STATIC_FOLDER = os.path.dirname(os.path.abspath(__file__))
ALLOWED_SUBJECTS = ['maths', 'bio', 'chem', 'physics']

# Manual CORS implementation
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

# Database helper functions
def get_db():
    """Get database connection"""
    conn = sqlite3.connect(app.config['DATABASE'])
    conn.row_factory = sqlite3.Row
    return conn

def normalize_subjects(raw_subjects):
    """Normalize subject selections into a clean list of allowed values."""
    if raw_subjects is None:
        return []

    if isinstance(raw_subjects, str):
        try:
            parsed = json.loads(raw_subjects)
            if isinstance(parsed, list):
                raw_list = parsed
            else:
                raw_list = [raw_subjects]
        except Exception:
            raw_list = [s.strip() for s in raw_subjects.split(',')]
    elif isinstance(raw_subjects, list):
        raw_list = raw_subjects
    else:
        return []

    cleaned = []
    for item in raw_list:
        if not isinstance(item, str):
            continue
        value = item.strip().lower()
        if value in ALLOWED_SUBJECTS and value not in cleaned:
            cleaned.append(value)
    return cleaned

def infer_subject_from_name(name):
    if not name:
        return None
    lowered = str(name).lower()
    if 'math' in lowered:
        return 'maths'
    if 'bio' in lowered:
        return 'bio'
    if 'chem' in lowered:
        return 'chem'
    if 'phys' in lowered:
        return 'physics'
    return None

def get_user_role_and_subjects(cursor, user_id):
    """Return (role, subjects_list) for a user id."""
    cursor.execute("SELECT role, subjects FROM users WHERE id = ?", (user_id,))
    row = cursor.fetchone()
    if not row:
        return None, []
    return row['role'], normalize_subjects(row['subjects'])

def get_staff_assigned_subjects(cursor, staff_id, student_id):
    """Return subjects for classes where staff is assigned to the student."""
    cursor.execute('''
        SELECT c.subject, c.name
        FROM enrollments e
        JOIN classes c ON e.class_id = c.id
        WHERE e.student_id = ? AND e.staff_id = ?
    ''', (student_id, staff_id))
    subjects = []
    for row in cursor.fetchall():
        subject = row['subject'] or infer_subject_from_name(row['name'])
        if subject and subject not in subjects:
            subjects.append(subject)
    return subjects

def init_db():
    """Initialize the database with tables"""
    conn = get_db()
    cursor = conn.cursor()
    
    # Users table (students, staff, admins)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('student', 'staff', 'admin')),
            disabled BOOLEAN DEFAULT 0,
            approved BOOLEAN DEFAULT 0,
            approved_at TIMESTAMP,
            approved_by INTEGER,
            requested_role TEXT,
            subjects TEXT,
            requested_subjects TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Student data table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS student_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            fee_balance DECIMAL(10,2) DEFAULT 0,
            attendance TEXT,
            grades TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    ''')
    
    # Classes table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS classes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            subject TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Class enrollments
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS enrollments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            class_id INTEGER NOT NULL,
            student_id INTEGER NOT NULL,
            staff_id INTEGER,
            enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
            FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (staff_id) REFERENCES users(id) ON DELETE SET NULL,
            UNIQUE(class_id, student_id)
        )
    ''')
    
    # Announcements table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS announcements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_user_id INTEGER NOT NULL,
            to_user_id INTEGER NOT NULL,
            text TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    ''')

    # Staff activities table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS staff_activities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            staff_id INTEGER NOT NULL,
            class_name TEXT NOT NULL,
            lectures_taken INTEGER DEFAULT 0,
            lectures_missed INTEGER DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (staff_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(staff_id, class_name)
        )
    ''')
    
    # Audit log table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_id INTEGER,
            action TEXT NOT NULL,
            target TEXT,
            details TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
        )
    ''')
    
    conn.commit()
    # Ensure approval columns exist for older databases
    cursor.execute("PRAGMA table_info(users)")
    existing_cols = {row['name'] for row in cursor.fetchall()}
    added_approval_cols = False
    if 'approved' not in existing_cols:
        cursor.execute("ALTER TABLE users ADD COLUMN approved BOOLEAN DEFAULT 0")
        added_approval_cols = True
    if 'approved_at' not in existing_cols:
        cursor.execute("ALTER TABLE users ADD COLUMN approved_at TIMESTAMP")
    if 'approved_by' not in existing_cols:
        cursor.execute("ALTER TABLE users ADD COLUMN approved_by INTEGER")
    if 'requested_role' not in existing_cols:
        cursor.execute("ALTER TABLE users ADD COLUMN requested_role TEXT")
    if 'subjects' not in existing_cols:
        cursor.execute("ALTER TABLE users ADD COLUMN subjects TEXT")
    if 'requested_subjects' not in existing_cols:
        cursor.execute("ALTER TABLE users ADD COLUMN requested_subjects TEXT")
    conn.commit()
    # Mark existing users as approved only on first migration
    if added_approval_cols:
        cursor.execute("UPDATE users SET approved = 1 WHERE approved IS NULL OR approved = 0")
        cursor.execute("UPDATE users SET requested_role = role WHERE requested_role IS NULL")
        conn.commit()

    cursor.execute("PRAGMA table_info(classes)")
    class_cols = {row['name'] for row in cursor.fetchall()}
    if 'subject' not in class_cols:
        cursor.execute("ALTER TABLE classes ADD COLUMN subject TEXT")
        conn.commit()

    cursor.execute("PRAGMA table_info(enrollments)")
    enroll_cols = {row['name'] for row in cursor.fetchall()}
    if 'staff_id' not in enroll_cols:
        cursor.execute("ALTER TABLE enrollments ADD COLUMN staff_id INTEGER")
        conn.commit()
    
    # Create default users if not exists
    default_users = [
        ('admin@school.com', 'admin123', 'System Administrator', 'admin'),
        ('staff@school.com', 'staff123', 'John Smith (Staff)', 'staff'),
        ('student@school.com', 'student123', 'Jane Doe (Student)', 'student'),
    ]
    
    for email, password, name, role in default_users:
        cursor.execute("SELECT * FROM users WHERE email = ?", (email,))
        if not cursor.fetchone():
            password_hash = generate_password_hash(password)
            cursor.execute('''
                INSERT INTO users (email, password_hash, name, role, approved, approved_at, requested_role)
                VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, ?)
            ''', (email, password_hash, name, role, role))
            conn.commit()
            print(f"Default {role} created: {email} / {password}")
            
            # Create student data if student
            if role == 'student':
                cursor.execute('''
                    INSERT INTO student_data (user_id, fee_balance, attendance, grades)
                    VALUES (?, 0, 'N/A', '{}')
                ''', (cursor.lastrowid,))
                conn.commit()

    default_classes = [
        ('Maths Class', 'Mathematics class', 'maths'),
        ('Bio Class', 'Biology class', 'bio'),
        ('Chem Class', 'Chemistry class', 'chem'),
        ('Physics Class', 'Physics class', 'physics')
    ]

    for name, description, subject in default_classes:
        cursor.execute("SELECT id FROM classes WHERE subject = ?", (subject,))
        existing = cursor.fetchone()
        if existing:
            cursor.execute("UPDATE classes SET name = ?, description = ? WHERE id = ?", (name, description, existing['id']))
        else:
            cursor.execute('''
                INSERT INTO classes (name, description, subject)
                VALUES (?, ?, ?)
            ''', (name, description, subject))
        conn.commit()
    
    conn.close()

def log_action(actor_id, action, target=None, details=None):
    """Log an action to the audit log"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO audit_log (actor_id, action, target, details)
        VALUES (?, ?, ?, ?)
    ''', (actor_id, action, target, details))
    conn.commit()
    conn.close()

# Authentication helpers (JWT)
def create_access_token(user_id, role):
    now = datetime.utcnow()
    payload = {
        'sub': str(user_id),
        'role': role,
        'iat': now,
        'exp': now + timedelta(hours=8)
    }
    token = jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')
    if isinstance(token, bytes):
        token = token.decode('utf-8')
    return token

def decode_access_token(token):
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload, None
    except jwt.ExpiredSignatureError:
        return None, 'Token expired'
    except jwt.InvalidTokenError:
        return None, 'Invalid token'

def get_bearer_token():
    auth = request.headers.get('Authorization', '')
    if auth.startswith('Bearer '):
        return auth[7:].strip()
    return None

def get_current_user():
    return getattr(g, 'current_user', None)

def require_roles(*roles):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            user = get_current_user()
            if not user:
                return jsonify({'error': 'Unauthorized'}), 401
            if user['role'] not in roles:
                return jsonify({'error': 'Forbidden'}), 403
            return fn(*args, **kwargs)
        return wrapper
    return decorator

@app.before_request
def enforce_jwt_for_api():
    if request.method == 'OPTIONS':
        return None
    if not request.path.startswith('/api/'):
        return None
    if request.path in ('/api/auth/login', '/api/auth/register'):
        return None

    token = get_bearer_token()
    if not token:
        return jsonify({'error': 'Authorization token required'}), 401

    payload, error = decode_access_token(token)
    if not payload:
        return jsonify({'error': error or 'Invalid token'}), 401

    user_id = payload.get('sub')
    if not user_id:
        return jsonify({'error': 'Invalid token payload'}), 401

    try:
        user_id_int = int(user_id)
    except (TypeError, ValueError):
        return jsonify({'error': 'Invalid token payload'}), 401

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, role, disabled, approved FROM users WHERE id = ?", (user_id_int,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return jsonify({'error': 'User not found'}), 401
    if row['disabled']:
        return jsonify({'error': 'Account is disabled'}), 403

    g.current_user = {'id': row['id'], 'role': row['role']}

# ==================== AUTHENTICATION ROUTES ====================

@app.route('/api/auth/login', methods=['POST'])
def login():
    """User login endpoint"""
    data = request.get_json()
    email = data.get('email', '').lower().strip()
    password = data.get('password', '')
    role = data.get('role', 'student')
    
    if not email or not password:
        return jsonify({'error': 'Email and password required'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE email = ?", (email,))
    user = cursor.fetchone()
    conn.close()
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    user_dict = dict(user)
    
    if not check_password_hash(user_dict['password_hash'], password):
        return jsonify({'error': 'Invalid password'}), 401
    
    if user_dict['role'] != role:
        return jsonify({'error': f'Account is not a {role} account'}), 403
    
    if user_dict.get('approved', 1) in (0, False):
        return jsonify({'error': 'Account pending approval'}), 403

    if user_dict['disabled']:
        return jsonify({'error': 'Account is disabled'}), 403
    
    # Log the login
    log_action(user_dict['id'], f'{role}_login', None)
    
    # Get student data if student
    student_data = None
    if user_dict['role'] == 'student':
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM student_data WHERE user_id = ?", (user_dict['id'],))
        sd = cursor.fetchone()
        if sd:
            student_data = {
                'feeBalance': sd['fee_balance'],
                'attendance': sd['attendance'],
                'grades': json.loads(sd['grades']) if sd['grades'] else {}
            }
        
        # Get announcements
        cursor.execute('''
            SELECT a.*, u.name as from_name 
            FROM announcements a
            JOIN users u ON a.from_user_id = u.id
            WHERE a.to_user_id = ?
            ORDER BY a.created_at DESC
            LIMIT 20
        ''', (user_dict['id'],))
        announcements = [dict(row) for row in cursor.fetchall()]
        if student_data:
            student_data['announcements'] = announcements
        conn.close()
    
    return jsonify({
        'user': {
            'id': user_dict['id'],
            'email': user_dict['email'],
            'name': user_dict['name'],
            'role': user_dict['role'],
            'studentData': student_data
        },
        'token': create_access_token(user_dict['id'], user_dict['role'])
    }), 200

@app.route('/api/auth/register', methods=['POST'])
def register():
    """User registration endpoint"""
    data = request.get_json()
    email = data.get('email', '').lower().strip()
    password = data.get('password', '')
    name = data.get('name', '')
    role = data.get('role', 'student')
    requested_role = data.get('requested_role', role)
    auto_approve = bool(data.get('auto_approve'))
    approved_by = data.get('approved_by')
    
    if not email or not password or not name:
        return jsonify({'error': 'Email, password, and name required'}), 400
    
    if role not in ['student', 'staff', 'admin']:
        return jsonify({'error': 'Invalid role'}), 400
    if requested_role not in ['student', 'staff', 'admin']:
        return jsonify({'error': 'Invalid requested role'}), 400

    requested_subjects_list = normalize_subjects(data.get('subjects'))
    if role in ['student', 'staff']:
        if not auto_approve and not requested_subjects_list:
            return jsonify({'error': 'Please select at least one subject'}), 400
    else:
        requested_subjects_list = []

    requested_subjects_json = json.dumps(requested_subjects_list) if requested_subjects_list else None
    subjects_json = requested_subjects_json if (auto_approve and requested_subjects_list) else None
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Check if user exists
    cursor.execute("SELECT id FROM users WHERE email = ?", (email,))
    if cursor.fetchone():
        conn.close()
        return jsonify({'error': 'Email already registered'}), 409
    
    # Create user
    password_hash = generate_password_hash(password)
    cursor.execute('''
        INSERT INTO users (
            email, password_hash, name, role, approved, approved_at,
            approved_by, requested_role, subjects, requested_subjects
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        email,
        password_hash,
        name,
        role,
        1 if auto_approve else 0,
        datetime.utcnow().isoformat() if auto_approve else None,
        approved_by,
        requested_role,
        subjects_json,
        requested_subjects_json
    ))
    user_id = cursor.lastrowid
    
    # Create student data if student
    if role == 'student':
        cursor.execute('''
            INSERT INTO student_data (user_id, fee_balance, attendance, grades)
            VALUES (?, 0, 'N/A', '{}')
        ''', (user_id,))
    
    conn.commit()
    conn.close()
    
    log_action(None, 'user_registered', email)
    
    return jsonify({
        'message': 'User registered successfully',
        'user': {
            'id': user_id,
            'email': email,
            'name': name,
            'role': role,
            'approved': True if auto_approve else False,
            'requested_role': requested_role,
            'subjects': requested_subjects_list if auto_approve else [],
            'requested_subjects': requested_subjects_list
        }
    }), 201

# ==================== USER ROUTES ====================

@app.route('/api/users', methods=['GET'])
def get_users():
    """Get users with role-aware filtering"""
    role = request.args.get('role')
    current = get_current_user()
    if not current:
        return jsonify({'error': 'Unauthorized'}), 401

    conn = get_db()
    cursor = conn.cursor()

    if current['role'] == 'admin':
        if role:
            cursor.execute("SELECT * FROM users WHERE role = ? ORDER BY name", (role,))
        else:
            cursor.execute("SELECT * FROM users ORDER BY role, name")

        users = [dict(row) for row in cursor.fetchall()]
        for user in users:
            user.pop('password_hash', None)
            user['subjects'] = normalize_subjects(user.get('subjects'))
            user['requested_subjects'] = normalize_subjects(user.get('requested_subjects'))
            if user['role'] == 'student':
                cursor.execute("SELECT * FROM student_data WHERE user_id = ?", (user['id'],))
                sd = cursor.fetchone()
                if sd:
                    user['studentData'] = {
                        'feeBalance': sd['fee_balance'],
                        'attendance': sd['attendance'],
                        'grades': json.loads(sd['grades']) if sd['grades'] else {}
                    }
        conn.close()
        return jsonify(users), 200

    if current['role'] == 'staff':
        if role and role != 'student':
            conn.close()
            return jsonify({'error': 'Forbidden'}), 403
        cursor.execute('''
            SELECT DISTINCT u.*, sd.fee_balance, sd.attendance, sd.grades
            FROM users u
            JOIN enrollments e ON u.id = e.student_id
            LEFT JOIN student_data sd ON u.id = sd.user_id
            WHERE u.role = 'student' AND e.staff_id = ?
            ORDER BY u.name
        ''', (current['id'],))
        users = [dict(row) for row in cursor.fetchall()]
        for user in users:
            user.pop('password_hash', None)
            user['subjects'] = normalize_subjects(user.get('subjects'))
            user['requested_subjects'] = normalize_subjects(user.get('requested_subjects'))
            user['studentData'] = {
                'feeBalance': user.pop('fee_balance', 0),
                'attendance': user.pop('attendance', 'N/A'),
                'grades': json.loads(user.pop('grades', '') or '{}')
            }
        conn.close()
        return jsonify(users), 200

    if current['role'] == 'student':
        if role and role != 'staff':
            conn.close()
            return jsonify({'error': 'Forbidden'}), 403
        cursor.execute("SELECT * FROM users WHERE role = 'staff' AND approved = 1 AND disabled = 0 ORDER BY name")
        users = [dict(row) for row in cursor.fetchall()]
        for user in users:
            user.pop('password_hash', None)
            user['subjects'] = normalize_subjects(user.get('subjects'))
            user['requested_subjects'] = normalize_subjects(user.get('requested_subjects'))
        conn.close()
        return jsonify(users), 200

    conn.close()
    return jsonify({'error': 'Forbidden'}), 403

@app.route('/api/users/pending', methods=['GET'])
@require_roles('admin')
def get_pending_users():
    """Get users pending approval"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE approved = 0 ORDER BY created_at DESC")
    users = [dict(row) for row in cursor.fetchall()]
    for user in users:
        user.pop('password_hash', None)
        user['subjects'] = normalize_subjects(user.get('subjects'))
        user['requested_subjects'] = normalize_subjects(user.get('requested_subjects'))
    conn.close()
    return jsonify(users), 200

@app.route('/api/users/<int:user_id>/approve', methods=['POST'])
@require_roles('admin')
def approve_user(user_id):
    """Approve a user and optionally assign role"""
    data = request.get_json() or {}
    role = data.get('role')
    current = get_current_user()
    actor_id = current['id'] if current else None
    
    if role and role not in ['student', 'staff', 'admin']:
        return jsonify({'error': 'Invalid role'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    user = cursor.fetchone()
    if not user:
        conn.close()
        return jsonify({'error': 'User not found'}), 404
    
    user_dict = dict(user)
    target_role = role or user_dict.get('requested_role') or user_dict.get('role')

    approved_subjects = normalize_subjects(data.get('subjects'))
    if not approved_subjects:
        approved_subjects = normalize_subjects(user_dict.get('requested_subjects'))
    if target_role not in ['student', 'staff']:
        approved_subjects = []
    approved_subjects_json = json.dumps(approved_subjects) if approved_subjects else None
    
    cursor.execute('''
        UPDATE users
        SET approved = 1,
            approved_at = CURRENT_TIMESTAMP,
            approved_by = ?,
            role = ?,
            subjects = ?,
            updated_at = CURRENT_TIMESTAMP,
            disabled = 0
        WHERE id = ?
    ''', (actor_id, target_role, approved_subjects_json, user_id))
    
    # Ensure student_data exists if approved as student
    if target_role == 'student':
        cursor.execute("SELECT id FROM student_data WHERE user_id = ?", (user_id,))
        if not cursor.fetchone():
            cursor.execute('''
                INSERT INTO student_data (user_id, fee_balance, attendance, grades)
                VALUES (?, 0, 'N/A', '{}')
            ''', (user_id,))
    
    conn.commit()
    conn.close()
    
    log_action(actor_id, 'approve_user', str(user_id), json.dumps({'role': target_role}))
    
    return jsonify({'message': 'User approved successfully', 'role': target_role}), 200

@app.route('/api/users/<int:user_id>', methods=['GET'])
def get_user(user_id):
    """Get a specific user"""
    current = get_current_user()
    if not current:
        return jsonify({'error': 'Unauthorized'}), 401
    if current['role'] != 'admin' and int(current['id']) != int(user_id):
        return jsonify({'error': 'Forbidden'}), 403
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    user = cursor.fetchone()
    
    if not user:
        conn.close()
        return jsonify({'error': 'User not found'}), 404
    
    user_dict = dict(user)
    user_dict.pop('password_hash', None)
    user_dict['subjects'] = normalize_subjects(user_dict.get('subjects'))
    user_dict['requested_subjects'] = normalize_subjects(user_dict.get('requested_subjects'))
    
    # Get student data if student
    if user_dict['role'] == 'student':
        cursor.execute("SELECT * FROM student_data WHERE user_id = ?", (user_id,))
        sd = cursor.fetchone()
        if sd:
            user_dict['studentData'] = {
                'feeBalance': sd['fee_balance'],
                'attendance': sd['attendance'],
                'grades': json.loads(sd['grades']) if sd['grades'] else {}
            }

        cursor.execute('''
            SELECT a.*, u.name as from_name
            FROM announcements a
            JOIN users u ON a.from_user_id = u.id
            WHERE a.to_user_id = ?
            ORDER BY a.created_at DESC
            LIMIT 20
        ''', (user_id,))
        announcements = [dict(row) for row in cursor.fetchall()]
        if 'studentData' not in user_dict or user_dict['studentData'] is None:
            user_dict['studentData'] = {
                'feeBalance': 0,
                'attendance': 'N/A',
                'grades': {}
            }
        user_dict['studentData']['announcements'] = announcements
    
    conn.close()
    return jsonify(user_dict), 200

@app.route('/api/users/<int:user_id>', methods=['PUT'])
def update_user(user_id):
    """Update a user"""
    data = request.get_json() or {}
    current = get_current_user()
    if not current:
        return jsonify({'error': 'Unauthorized'}), 401
    if current['role'] != 'admin' and int(current['id']) != int(user_id):
        return jsonify({'error': 'Forbidden'}), 403
    actor_id = current['id']
    
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT role FROM users WHERE id = ?", (user_id,))
    user_row = cursor.fetchone()
    if not user_row:
        conn.close()
        return jsonify({'error': 'User not found'}), 404

    current_role = user_row['role']
    
    # Update user basic info
    if 'name' in data:
        cursor.execute("UPDATE users SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", 
                      (data['name'], user_id))

    if 'email' in data:
        new_email = str(data['email']).lower().strip()
        if not new_email:
            conn.close()
            return jsonify({'error': 'Email is required'}), 400
        cursor.execute("SELECT id FROM users WHERE email = ? AND id != ?", (new_email, user_id))
        if cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Email already registered'}), 409
        cursor.execute("UPDATE users SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                      (new_email, user_id))
    
    if 'disabled' in data:
        cursor.execute("UPDATE users SET disabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", 
                      (data['disabled'], user_id))

    if 'subjects' in data:
        subjects_list = normalize_subjects(data.get('subjects'))
        if current_role not in ('student', 'staff'):
            subjects_list = []
        subjects_json = json.dumps(subjects_list) if subjects_list else None
        cursor.execute("UPDATE users SET subjects = ?, requested_subjects = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                      (subjects_json, subjects_json, user_id))
    
    # Update student data if provided
    if 'studentData' in data:
        sd = data['studentData']
        cursor.execute("SELECT id FROM student_data WHERE user_id = ?", (user_id,))
        if cursor.fetchone():
            cursor.execute('''
                UPDATE student_data 
                SET fee_balance = ?, attendance = ?, grades = ?
                WHERE user_id = ?
            ''', (
                sd.get('feeBalance', 0),
                sd.get('attendance', ''),
                json.dumps(sd.get('grades', {})),
                user_id
            ))
        else:
            cursor.execute('''
                INSERT INTO student_data (user_id, fee_balance, attendance, grades)
                VALUES (?, ?, ?, ?)
            ''', (
                user_id,
                sd.get('feeBalance', 0),
                sd.get('attendance', ''),
                json.dumps(sd.get('grades', {}))
            ))
    
    conn.commit()
    conn.close()
    
    log_action(actor_id, 'update_user', str(user_id))
    
    return jsonify({'message': 'User updated successfully'}), 200

@app.route('/api/users/<int:user_id>', methods=['DELETE'])
@require_roles('admin')
def delete_user(user_id):
    """Delete a user"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()
    
    actor_id = get_current_user()['id'] if get_current_user() else None
    log_action(actor_id, 'delete_user', str(user_id))
    
    return jsonify({'message': 'User deleted successfully'}), 200

# ==================== STUDENT DATA ROUTES ====================

@app.route('/api/students/<int:student_id>/attendance', methods=['PUT'])
def update_attendance(student_id):
    """Update student attendance"""
    data = request.get_json() or {}
    attendance = data.get('attendance', '')
    current = get_current_user()
    if not current:
        return jsonify({'error': 'Unauthorized'}), 401
    actor_id = current['id']
    
    try:
        conn = get_db()
        cursor = conn.cursor()

        role, staff_subjects = get_user_role_and_subjects(cursor, actor_id)
        if not role or role not in ('staff', 'admin'):
            conn.close()
            return jsonify({'error': 'Only staff can update attendance'}), 403

        if role == 'staff':
            cursor.execute("SELECT id FROM users WHERE id = ? AND role = 'student'", (student_id,))
            student_row = cursor.fetchone()
            if not student_row:
                conn.close()
                return jsonify({'error': 'Student not found'}), 404
            assigned_subjects = get_staff_assigned_subjects(cursor, actor_id, student_id)
            if not assigned_subjects:
                conn.close()
                return jsonify({'error': 'You can only update attendance for students assigned to you'}), 403
        
        # Update or insert student_data
        cursor.execute('''
            UPDATE student_data
            SET attendance = ?
            WHERE user_id = ?
        ''', (attendance, student_id))

        if cursor.rowcount == 0:
            cursor.execute('''
                INSERT INTO student_data (user_id, attendance)
                VALUES (?, ?)
            ''', (student_id, attendance))
        
        conn.commit()
        conn.close()
        
        log_action(actor_id, 'update_attendance', str(student_id))
        
        return jsonify({'message': 'Attendance updated successfully'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/students/<int:student_id>/grades', methods=['PUT'])
def update_grades(student_id):
    """Update student grades"""
    data = request.get_json() or {}
    grades = data.get('grades', {})
    current = get_current_user()
    if not current:
        return jsonify({'error': 'Unauthorized'}), 401
    actor_id = current['id']
    if not isinstance(grades, dict):
        return jsonify({'error': 'grades must be an object'}), 400
    
    try:
        conn = get_db()
        cursor = conn.cursor()

        role, staff_subjects = get_user_role_and_subjects(cursor, actor_id)
        if not role or role not in ('staff', 'admin'):
            conn.close()
            return jsonify({'error': 'Only staff can update grades'}), 403

        grades_to_store = grades

        if role == 'staff':
            cursor.execute("SELECT id FROM users WHERE id = ? AND role = 'student'", (student_id,))
            student_row = cursor.fetchone()
            if not student_row:
                conn.close()
                return jsonify({'error': 'Student not found'}), 404

            assigned_subjects = get_staff_assigned_subjects(cursor, actor_id, student_id)
            allowed = set(assigned_subjects)
            if not allowed:
                conn.close()
                return jsonify({'error': 'You can only update grades for students assigned to you'}), 403

            cursor.execute("SELECT grades FROM student_data WHERE user_id = ?", (student_id,))
            existing_row = cursor.fetchone()
            existing_grades = json.loads(existing_row['grades']) if existing_row and existing_row['grades'] else {}
            updated_grades = dict(existing_grades)

            for subject in list(updated_grades.keys()):
                if subject in allowed and subject not in grades:
                    updated_grades.pop(subject, None)

            for subject, value in grades.items():
                if subject in allowed:
                    updated_grades[subject] = value

            grades_to_store = updated_grades
        
        # Update or insert student_data with grades as JSON
        grades_json = json.dumps(grades_to_store)
        cursor.execute('''
            UPDATE student_data
            SET grades = ?
            WHERE user_id = ?
        ''', (grades_json, student_id))

        if cursor.rowcount == 0:
            cursor.execute('''
                INSERT INTO student_data (user_id, grades)
                VALUES (?, ?)
            ''', (student_id, grades_json))
        
        conn.commit()
        conn.close()
        
        log_action(actor_id, 'update_grades', str(student_id))
        
        return jsonify({'message': 'Grades updated successfully'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/students/search', methods=['GET'])
def search_students():
    """Search for students by name or email"""
    query = request.args.get('q', '').lower()
    
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Search students by name or email
        cursor.execute('''
            SELECT u.*, sd.fee_balance, sd.attendance, sd.grades
            FROM users u
            LEFT JOIN student_data sd ON u.id = sd.user_id
            WHERE u.role = 'student' AND (
                LOWER(u.name) LIKE ? OR 
                LOWER(u.email) LIKE ?
            )
            ORDER BY u.name
        ''', (f'%{query}%', f'%{query}%'))
        
        students = [dict(row) for row in cursor.fetchall()]
        conn.close()
        
        # Parse grades JSON if present
        for student in students:
            if student.get('grades'):
                try:
                    student['grades'] = json.loads(student['grades'])
                except:
                    student['grades'] = {}
        
        return jsonify(students), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ==================== CLASS ROUTES ====================

@app.route('/api/classes', methods=['GET'])
def get_classes():
    """Get all classes"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM classes ORDER BY name")
    classes = [dict(row) for row in cursor.fetchall()]
    
    # Get enrolled students for each class
    for cls in classes:
        cursor.execute('''
            SELECT u.id, u.email, u.name, e.staff_id
            FROM enrollments e
            JOIN users u ON e.student_id = u.id
            WHERE e.class_id = ?
        ''', (cls['id'],))
        cls['students'] = [dict(row) for row in cursor.fetchall()]
        cls['studentIds'] = [s['email'] for s in cls['students']]
    
    conn.close()
    return jsonify(classes), 200

@app.route('/api/classes', methods=['POST'])
@require_roles('admin')
def create_class():
    """Create a new class"""
    data = request.get_json() or {}
    current = get_current_user()
    actor_id = current['id'] if current else None
    name = data.get('name', '')
    description = data.get('description', '')
    subject = data.get('subject')
    
    if not name:
        return jsonify({'error': 'Class name required'}), 400

    if subject:
        subject = str(subject).strip().lower()
        if subject not in ALLOWED_SUBJECTS:
            return jsonify({'error': 'Invalid subject'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO classes (name, description, subject)
        VALUES (?, ?, ?)
    ''', (name, description, subject))
    class_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    log_action(actor_id, 'create_class', name)
    
    return jsonify({
        'message': 'Class created successfully',
        'class_id': class_id,
        'subject': subject
    }), 201

@app.route('/api/classes/<int:class_id>/enroll', methods=['POST'])
def enroll_student(class_id):
    """Enroll a student in a class"""
    data = request.get_json() or {}
    student_id = data.get('student_id')
    staff_id = data.get('staff_id')

    if staff_id in ('', None):
        staff_id = None

    if not student_id:
        return jsonify({'error': 'Student ID required'}), 400

    current = get_current_user()
    if not current:
        return jsonify({'error': 'Unauthorized'}), 401

    actor_id = current['id']
    actor_role = current['role']

    if actor_role == 'student' and int(actor_id) != int(student_id):
        return jsonify({'error': 'Students can only enroll themselves'}), 403
    if actor_role not in ('student', 'admin'):
        return jsonify({'error': 'Only admins or students can enroll'}), 403

    conn = get_db()
    cursor = conn.cursor()

    if staff_id and actor_role != 'admin':
        conn.close()
        return jsonify({'error': 'Only admin can assign staff'}), 403

    cursor.execute("SELECT role, subjects FROM users WHERE id = ?", (student_id,))
    student_row = cursor.fetchone()
    if not student_row or student_row['role'] != 'student':
        conn.close()
        return jsonify({'error': 'Student not found'}), 404

    student_subjects = normalize_subjects(student_row['subjects'])

    cursor.execute("SELECT id, name, subject FROM classes WHERE id = ?", (class_id,))
    class_row = cursor.fetchone()
    if not class_row:
        conn.close()
        return jsonify({'error': 'Class not found'}), 404

    class_subject = class_row['subject']
    if not class_subject:
        class_subject = infer_subject_from_name(class_row['name'])

    if class_subject and class_subject not in student_subjects:
        conn.close()
        return jsonify({'error': 'Student is not approved for this subject'}), 403

    if staff_id:
        cursor.execute("SELECT role, subjects FROM users WHERE id = ?", (staff_id,))
        staff_row = cursor.fetchone()
        if not staff_row or staff_row['role'] not in ('staff', 'admin'):
            conn.close()
            return jsonify({'error': 'Selected staff member not found'}), 404
        if staff_row['role'] == 'staff' and class_subject:
            staff_subjects = normalize_subjects(staff_row['subjects'])
            if class_subject not in staff_subjects:
                conn.close()
                return jsonify({'error': 'Staff member cannot teach this subject'}), 403

    cursor.execute("SELECT id FROM enrollments WHERE class_id = ? AND student_id = ?", (class_id, student_id))
    existing = cursor.fetchone()

    if existing:
        cursor.execute("UPDATE enrollments SET staff_id = ?, enrolled_at = CURRENT_TIMESTAMP WHERE id = ?", (staff_id, existing['id']))
        conn.commit()
        conn.close()
        log_action(actor_id, 'enroll_student', f'Class {class_id}, Student {student_id} (updated)')
        return jsonify({'message': 'Enrollment updated successfully'}), 200

    try:
        cursor.execute("INSERT INTO enrollments (class_id, student_id, staff_id) VALUES (?, ?, ?)", (class_id, student_id, staff_id))
        conn.commit()
        conn.close()

        log_action(actor_id, 'enroll_student', f'Class {class_id}, Student {student_id}')

        return jsonify({'message': 'Student enrolled successfully'}), 200
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': 'Student already enrolled'}), 409


# ==================== ANNOUNCEMENT ROUTES ====================

@app.route('/api/announcements', methods=['POST'])
def create_announcement():
    """Send announcement to student(s)"""
    data = request.get_json() or {}
    current = get_current_user()
    if not current:
        return jsonify({'error': 'Unauthorized'}), 401
    from_user_id = current['id']
    to_user_ids = data.get('to_user_ids', [])
    text = (data.get('text') or '').strip()
    
    if not to_user_ids or not text:
        return jsonify({'error': 'Missing required fields'}), 400
    
    conn = get_db()
    cursor = conn.cursor()

    role, staff_subjects = get_user_role_and_subjects(cursor, from_user_id)
    if not role or role not in ('staff', 'admin'):
        conn.close()
        return jsonify({'error': 'Only staff can send announcements'}), 403

    allowed_ids = []
    unique_ids = []
    seen_ids = set()
    for value in to_user_ids:
        try:
            to_user_id = int(value)
        except (TypeError, ValueError):
            continue
        if to_user_id in seen_ids:
            continue
        seen_ids.add(to_user_id)
        unique_ids.append(to_user_id)

    if role == 'staff':
        if not staff_subjects:
            conn.close()
            return jsonify({'error': 'No approved subjects assigned to staff'}), 403

        staff_subject_set = set(staff_subjects)
        for to_user_id in unique_ids:
            cursor.execute("SELECT role, subjects FROM users WHERE id = ?", (to_user_id,))
            row = cursor.fetchone()
            if not row or row['role'] != 'student':
                continue
            student_subjects = normalize_subjects(row['subjects'])
            if staff_subject_set.intersection(student_subjects):
                allowed_ids.append(to_user_id)
    else:
        for to_user_id in unique_ids:
            cursor.execute("SELECT role FROM users WHERE id = ?", (to_user_id,))
            row = cursor.fetchone()
            if row and row['role'] == 'student':
                allowed_ids.append(to_user_id)

    if not allowed_ids:
        conn.close()
        return jsonify({'error': 'No eligible students to announce to'}), 403

    for to_user_id in allowed_ids:
        cursor.execute('''
            INSERT INTO announcements (from_user_id, to_user_id, text)
            VALUES (?, ?, ?)
        ''', (from_user_id, to_user_id, text))
    
    conn.commit()
    conn.close()
    
    log_action(from_user_id, 'send_announcement', f'{len(allowed_ids)} students')
    
    return jsonify({'message': 'Announcement sent successfully'}), 201

@app.route('/api/announcements/student/<int:student_id>', methods=['GET'])
def get_student_announcements(student_id):
    """Get announcements for a student"""
    current = get_current_user()
    if not current:
        return jsonify({'error': 'Unauthorized'}), 401
    if current['role'] != 'admin' and int(current['id']) != int(student_id):
        return jsonify({'error': 'Forbidden'}), 403
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT a.*, u.name as from_name
        FROM announcements a
        JOIN users u ON a.from_user_id = u.id
        WHERE a.to_user_id = ?
        ORDER BY a.created_at DESC
    ''', (student_id,))
    
    announcements = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    return jsonify(announcements), 200

# ==================== AUDIT LOG ROUTES ====================

@app.route('/api/audit', methods=['GET'])
@require_roles('admin')
def get_audit_log():
    """Get audit log entries"""
    limit = request.args.get('limit', 50, type=int)
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT a.*, u.email as actor_email, u.name as actor_name
        FROM audit_log a
        LEFT JOIN users u ON a.actor_id = u.id
        ORDER BY a.created_at DESC
        LIMIT ?
    ''', (limit,))
    
    logs = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    return jsonify(logs), 200

# ==================== REPORT ROUTES ====================


@app.route('/api/users/<int:user_id>/password', methods=['POST'])
def change_user_password(user_id):
    """Change user password (self only)"""
    data = request.get_json() or {}
    current_password = data.get('current_password', '')
    new_password = data.get('new_password', '')
    current = get_current_user()
    if not current:
        return jsonify({'error': 'Unauthorized'}), 401
    actor_id = current['id']

    if not current_password or not new_password:
        return jsonify({'error': 'Current and new passwords are required'}), 400

    if len(new_password) < 6:
        return jsonify({'error': 'New password must be at least 6 characters'}), 400

    if str(actor_id) != str(user_id):
        return jsonify({'error': 'You can only change your own password'}), 403

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, password_hash FROM users WHERE id = ?", (user_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return jsonify({'error': 'User not found'}), 404

    if not check_password_hash(row['password_hash'], current_password):
        conn.close()
        return jsonify({'error': 'Current password is incorrect'}), 401

    cursor.execute(
        "UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (generate_password_hash(new_password), user_id)
    )
    conn.commit()
    conn.close()

    log_action(actor_id, 'change_password', str(user_id))
    return jsonify({'message': 'Password updated successfully'}), 200


@app.route('/api/backup/download', methods=['GET'])
@require_roles('admin')
def download_backup():
    """Download SQLite database backup"""
    db_path = app.config['DATABASE']
    if not os.path.exists(db_path):
        return jsonify({'error': 'Database file not found'}), 404

    try:
        return send_file(db_path, as_attachment=True, download_name='student_management_backup.db')
    except TypeError:
        # Fallback for older Flask
        return send_file(db_path, as_attachment=True, attachment_filename='student_management_backup.db')


@app.route('/api/backup/restore', methods=['POST'])
@require_roles('admin')
def restore_backup():
    """Restore SQLite database from uploaded backup"""
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400

    file = request.files['file']
    if not file.filename or not file.filename.lower().endswith('.db'):
        return jsonify({'error': 'Invalid file type. Please upload a .db file'}), 400

    db_path = app.config['DATABASE']
    temp_path = db_path + '.restore'

    file.save(temp_path)

    # Validate backup file
    try:
        conn = sqlite3.connect(temp_path)
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
        if not cursor.fetchone():
            conn.close()
            os.remove(temp_path)
            return jsonify({'error': 'Invalid backup file'}), 400
        conn.close()
    except Exception as exc:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        return jsonify({'error': f'Failed to validate backup: {exc}'}), 400

    # Replace existing database
    os.replace(temp_path, db_path)

    # Ensure schema migrations are applied
    init_db()

    return jsonify({'message': 'Backup restored successfully. Please restart the server.'}), 200

@app.route('/api/reports/student-summary', methods=['GET'])
@require_roles('admin')
def report_student_summary():
    """Get student summary report (attendance, grades, class, fee balance)"""
    class_id = request.args.get('class_id', type=int)
    
    conn = get_db()
    cursor = conn.cursor()
    
    if class_id:
        cursor.execute('''
            SELECT u.id, u.name, u.email, sd.attendance, sd.grades, sd.fee_balance,
                   GROUP_CONCAT(c.name, ', ') as classes
            FROM users u
            LEFT JOIN student_data sd ON u.id = sd.user_id
            JOIN enrollments e ON u.id = e.student_id
            JOIN classes c ON e.class_id = c.id
            WHERE u.role = 'student' AND u.approved = 1 AND e.class_id = ?
            GROUP BY u.id, u.name, u.email, sd.attendance, sd.grades, sd.fee_balance
            ORDER BY u.name
        ''', (class_id,))
    else:
        cursor.execute('''
            SELECT u.id, u.name, u.email, sd.attendance, sd.grades, sd.fee_balance,
                   GROUP_CONCAT(c.name, ', ') as classes
            FROM users u
            LEFT JOIN student_data sd ON u.id = sd.user_id
            LEFT JOIN enrollments e ON u.id = e.student_id
            LEFT JOIN classes c ON e.class_id = c.id
            WHERE u.role = 'student' AND u.approved = 1
            GROUP BY u.id, u.name, u.email, sd.attendance, sd.grades, sd.fee_balance
            ORDER BY u.name
        ''')
    
    rows = [dict(row) for row in cursor.fetchall()]
    for r in rows:
        if r.get('grades'):
            try:
                r['grades'] = json.loads(r['grades'])
            except:
                r['grades'] = {}
    conn.close()
    return jsonify(rows), 200

@app.route('/api/reports/staff-activities', methods=['GET', 'POST'])
@require_roles('admin')
def staff_activities_report():
    """Get or update staff activities"""
    if request.method == 'GET':
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT sa.id, sa.staff_id, sa.class_name, sa.lectures_taken, sa.lectures_missed,
                   sa.updated_at, u.name as staff_name, u.email as staff_email
            FROM staff_activities sa
            JOIN users u ON sa.staff_id = u.id
            WHERE u.role = 'staff' OR u.role = 'admin'
            ORDER BY u.name, sa.class_name
        ''')
        rows = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify(rows), 200
    
    data = request.get_json() or {}
    staff_id = data.get('staff_id')
    class_name = (data.get('class_name') or '').strip()
    lectures_taken = data.get('lectures_taken', 0)
    lectures_missed = data.get('lectures_missed', 0)
    
    if not staff_id or not class_name:
        return jsonify({'error': 'staff_id and class_name are required'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM users WHERE id = ? AND role IN ('staff','admin')", (staff_id,))
    if not cursor.fetchone():
        conn.close()
        return jsonify({'error': 'Staff member not found'}), 404
    
    cursor.execute('''
        INSERT INTO staff_activities (staff_id, class_name, lectures_taken, lectures_missed, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(staff_id, class_name) DO UPDATE SET
            lectures_taken = excluded.lectures_taken,
            lectures_missed = excluded.lectures_missed,
            updated_at = CURRENT_TIMESTAMP
    ''', (staff_id, class_name, lectures_taken, lectures_missed))
    
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'Staff activity saved'}), 200

# ==================== STATISTICS ROUTES ====================

@app.route('/api/stats', methods=['GET'])
@require_roles('admin')
def get_statistics():
    """Get system statistics"""
    conn = get_db()
    cursor = conn.cursor()
    
    # Count users by role
    cursor.execute("SELECT role, COUNT(*) as count FROM users GROUP BY role")
    user_counts = {row['role']: row['count'] for row in cursor.fetchall()}
    
    # Count classes
    cursor.execute("SELECT COUNT(*) as count FROM classes")
    class_count = cursor.fetchone()['count']
    
    # Total fees
    cursor.execute("SELECT SUM(fee_balance) as total FROM student_data")
    total_fees = cursor.fetchone()['total'] or 0
    
    cursor.execute("SELECT COUNT(*) as count FROM users WHERE approved = 0")
    pending_count = cursor.fetchone()['count']
    
    conn.close()
    
    return jsonify({
        'users': user_counts,
        'classes': class_count,
        'total_fees': float(total_fees),
        'pending_approvals': pending_count
    }), 200

# ==================== STATIC FILE SERVING ====================

@app.route('/')
def index():
    """Serve login page as default"""
    try:
        # Try current directory first
        if os.path.exists(os.path.join(STATIC_FOLDER, 'login.html')):
            return send_from_directory(STATIC_FOLDER, 'login.html')
        # Fallback to outputs directory
        elif os.path.exists('/mnt/user-data/outputs/login.html'):
            return send_from_directory('/mnt/user-data/outputs', 'login.html')
        else:
            return """
            <html>
            <head><title>Setup Required</title></head>
            <body style="font-family: Arial; padding: 50px; max-width: 800px; margin: 0 auto;">
                <h1>⚠️ Setup Required</h1>
                <p>The HTML files are not in the same directory as app.py</p>
                <h3>Quick Fix:</h3>
                <ol>
                    <li>Copy all .html files to the same folder as app.py</li>
                    <li>Restart the server</li>
                    <li>Refresh this page</li>
                </ol>
                <p>Expected files: login.html, admin.html, student.html, staff.html, students.html, reports.html</p>
                <p><strong>Current directory:</strong> {}</p>
            </body>
            </html>
            """.format(STATIC_FOLDER), 200
    except Exception as e:
        return jsonify({'error': 'Could not load login page', 'details': str(e)}), 500

@app.route('/<path:filename>')
def serve_static(filename):
    """Serve static files (HTML, CSS, JS)"""
    # Only serve .html, .css, .js files to prevent directory listing
    if not filename.endswith(('.html', '.css', '.js')):
        return jsonify({'error': 'Not found'}), 404
    
    try:
        # Try current directory first
        if os.path.exists(os.path.join(STATIC_FOLDER, filename)):
            return send_from_directory(STATIC_FOLDER, filename)
        # Fallback to outputs directory
        elif os.path.exists(os.path.join('/mnt/user-data/outputs', filename)):
            return send_from_directory('/mnt/user-data/outputs', filename)
        else:
            return jsonify({'error': 'File not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ==================== MAIN ====================

if __name__ == '__main__':
    print("Initializing database...")
    init_db()
    print("Database initialized!")
    print("\n" + "="*60)
    print("Student Management System API Server")
    print("="*60)
    print("\nDefault Admin Credentials:")
    print("  Email: admin@school.com")
    print("  Password: admin123")
    print("\nAPI Endpoints:")
    print("  Authentication:")
    print("    POST /api/auth/login")
    print("    POST /api/auth/register")
    print("  Users:")
    print("    GET    /api/users")
    print("    GET    /api/users/<id>")
    print("    PUT    /api/users/<id>")
    print("    DELETE /api/users/<id>")
    print("  Classes:")
    print("    GET  /api/classes")
    print("    POST /api/classes")
    print("    POST /api/classes/<id>/enroll")
    print("  Announcements:")
    print("    POST /api/announcements")
    print("    GET  /api/announcements/student/<id>")
    print("  Other:")
    print("    GET /api/audit")
    print("    GET /api/stats")
    print("\n" + "="*60)
    print("\nStarting server on http://localhost:5000")
    print("Press CTRL+C to stop\n")
    
    app.run(debug=True, host='0.0.0.0', port=5000)

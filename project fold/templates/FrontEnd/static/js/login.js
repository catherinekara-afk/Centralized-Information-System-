// ─── Config ────────────────────────────────────────────────
// Flask runs on port 5000. All requests go there.
const API_BASE = 'https://centralized-information-system.onrender.com/';

// ─── Helpers ───────────────────────────────────────────────
function showAlert(message, type = 'error') {
    const el = document.getElementById('alert');
    el.textContent = message;
    el.className = `alert ${type}`;
    el.style.display = 'block';
    if (type === 'error') setTimeout(() => { el.style.display = 'none'; }, 5000);
}

function setLoading(loading) {
    const btn = document.getElementById('submitBtn');
    btn.disabled = loading;
    btn.textContent = loading ? 'Signing in…' : 'Sign In';
}

// ─── Login handler ─────────────────────────────────────────
document.getElementById('loginForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    const email    = document.getElementById('email').value.trim().toLowerCase();
    const password = document.getElementById('password').value;
    const role     = document.querySelector('input[name="role"]:checked').value;

    if (!email || !password) {
        showAlert('Please enter both email and password.');
        return;
    }

    setLoading(true);

    try {
        const response = await fetch(`${API_BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, role })
        });

        const data = await response.json();

        if (!response.ok) {
            // Flask returns an "error" key on failure
            showAlert(data.error || 'Login failed. Please try again.');
            setLoading(false);
            return;
        }

        // ── Success ──────────────────────────────────────
        // Store user info and token in sessionStorage so
        // other pages can access them without localStorage tricks.
        sessionStorage.setItem('current_user',  JSON.stringify(data.user));
        sessionStorage.setItem('auth_token',    data.token);

        showAlert('Login successful! Redirecting…', 'success');

        setTimeout(() => {
            switch (role) {
                case 'student': window.location.href = 'student.html'; break;
                case 'staff':   window.location.href = 'staff.html';   break;
                case 'admin':   window.location.href = 'admin.html';   break;
            }
        }, 1000);

    } catch (err) {
        console.error('Login error:', err);
        showAlert('Cannot reach the server. Make sure Flask (app.py) is running on port 5000.');
        setLoading(false);
    }
});

// ─── Demo auto-fill ────────────────────────────────────────
if (window.location.search.includes('demo')) {
    document.getElementById('email').value = 'admin@school.com';
    document.getElementById('password').value = 'admin123';
    document.getElementById('roleAdmin').checked = true;
}

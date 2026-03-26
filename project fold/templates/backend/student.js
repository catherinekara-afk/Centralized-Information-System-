// Student Dashboard JavaScript

// Configuration
const API_BASE = 'https://centralized-information-system.onrender.com/';

function apiFetch(url, options = {}) {
    const headers = options.headers ? { ...options.headers } : {};
    const token = studentState.authToken || sessionStorage.getItem('auth_token');
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    if (!headers['Content-Type'] && options.body && !(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
    }
    return fetch(url, { ...options, headers }).then((res) => {
        if (res.status === 401) {
            sessionStorage.removeItem('current_user');
            sessionStorage.removeItem('auth_token');
            if (typeof showNotification === 'function') {
                showNotification('Session expired. Please login again.', 'error');
            }
            if (!window.location.pathname.endsWith('login.html')) {
                setTimeout(() => { window.location.href = 'login.html'; }, 800);
            }
        }
        return res;
    });
}


// Page state
const studentState = {
    currentUser: null,
    authToken: null,
    studentData: {},
    classes: [],
    staffList: []
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    loadAuthData();
    setupEventListeners();
});

// Load authentication data from session
function loadAuthData() {
    const userStr = sessionStorage.getItem('current_user');
    const token = sessionStorage.getItem('auth_token');
    
    if (!userStr || !token) {
        // No auth data, redirect to login
        showNotification('Please login first', 'error');
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 2000);
        return;
    }
    
    const user = JSON.parse(userStr);
    
    // Verify this is a student
    if (user.role !== 'student') {
        showNotification('Access denied: Student account required', 'error');
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 2000);
        return;
    }
    
    studentState.currentUser = user;
    studentState.authToken = token;
    
    // Update UI with user info
    document.getElementById('studentName').textContent = user.name || 'Student';
    document.getElementById('studentEmail').textContent = user.email || '';
    
    // Load student data from backend
    loadStudentData();
}

// Load student data from backend API
async function loadStudentData() {
    try {
        const response = await apiFetch(`${API_BASE}/api/users/${studentState.currentUser.id}`, {
            headers: {
                'Authorization': `Bearer ${studentState.authToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to fetch student data');
        }
        
        const data = await response.json();
        studentState.studentData = data;
        
        // Update dashboard with data
        updateDashboard();
        loadClassOptions();
        
    } catch (error) {
        console.error('Error loading student data:', error);
        showNotification('Failed to load student data', 'error');
        
        // Fallback to user data from session
        if (studentState.currentUser.studentData) {
            studentState.studentData = studentState.currentUser.studentData;
            updateDashboard();
            loadClassOptions();
        }
    }
}

// Update dashboard display
function updateDashboard() {
    const data = studentState.studentData;
    
    // Fee Balance
    const feeBalance = data.studentData?.feeBalance ?? data.studentData?.fee_balance ?? 0;
    const feeEl = document.getElementById('feeBalance');
    if (feeEl) {
        feeEl.textContent = formatFee(feeBalance);
    }
    
    // Attendance
    const attendance = data.studentData?.attendance ?? 'N/A';
    document.getElementById('attendance').textContent = attendance;
    
    // Status
    const status = data.disabled ? 'Inactive' : 'Active';
    const statusEl = document.getElementById('academicStatus');
    if (statusEl) {
        statusEl.textContent = status;
    }

    // Subjects
    const subjects = normalizeSubjects(data.subjects);
    const subjectsEl = document.getElementById('subjectsList');
    if (subjectsEl) {
        subjectsEl.textContent = formatSubjects(subjects);
    }
    renderSubjectsList(subjects);

    renderClassChoices(subjects);
    // Announcements
    const announcements = data.studentData?.announcements || [];
    renderAnnouncements(announcements);
    
    // Grades
    const grades = data.studentData?.grades || {};
    renderGrades(grades);
}

function normalizeSubjects(subjects) {
    if (!subjects) return [];
    if (Array.isArray(subjects)) return subjects;
    if (typeof subjects === 'string') {
        try {
            const parsed = JSON.parse(subjects);
            if (Array.isArray(parsed)) return parsed;
        } catch (err) {
            return subjects.split(',').map(s => s.trim()).filter(Boolean);
        }
    }
    return [];
}

function formatSubjects(subjects) {
    if (!subjects || subjects.length === 0) return 'None';

    const labels = {
        maths: 'Maths',
        bio: 'Bio',
        chem: 'Chem',
        physics: 'Physics'
    };

    return subjects.map(s => labels[s] || s).join(', ');
}

function formatFee(value) {
    const num = Number(value);
    if (Number.isNaN(num)) return 'Ksh 0.00';
    return 'Ksh ' + num.toFixed(2);
}

function renderSubjectsList(subjects) {
    const container = document.getElementById('subjectsContainer');
    if (!container) return;

    container.innerHTML = '';
    if (!subjects || subjects.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'subjects-empty';
        empty.textContent = 'No approved subjects yet';
        container.appendChild(empty);
        return;
    }

    const labels = {
        maths: 'Maths',
        bio: 'Bio',
        chem: 'Chem',
        physics: 'Physics'
    };

    subjects.forEach(subject => {
        const tag = document.createElement('span');
        tag.className = 'subject-tag';
        tag.textContent = labels[subject] || subject;
        container.appendChild(tag);
    });
}

async function loadClassOptions() {
    try {
        const [classesRes, staffRes] = await Promise.all([
            apiFetch(`${API_BASE}/api/classes`, {
                headers: {
                    'Authorization': `Bearer ${studentState.authToken}`,
                    'Content-Type': 'application/json'
                }
            }),
            apiFetch(`${API_BASE}/api/users?role=staff`, {
                headers: {
                    'Authorization': `Bearer ${studentState.authToken}`,
                    'Content-Type': 'application/json'
                }
            })
        ]);

        if (classesRes.ok) {
            studentState.classes = await classesRes.json();
        }
        if (staffRes.ok) {
            studentState.staffList = await staffRes.json();
        }

        const subjects = normalizeSubjects(studentState.studentData.subjects || studentState.currentUser?.subjects);
        renderClassChoices(subjects);
    } catch (error) {
        console.error('Error loading classes:', error);
    }
}

function getSubjectLabel(subject) {
    const labels = {
        maths: 'Maths',
        bio: 'Bio',
        chem: 'Chem',
        physics: 'Physics'
    };
    return labels[subject] || subject;
}

function renderClassChoices(subjects) {
    const container = document.getElementById('classesContainer');
    if (!container) return;

    if (!subjects || subjects.length === 0) {
        container.innerHTML = '<div class="no-data">No approved subjects yet</div>';
        return;
    }

    if (!studentState.classes || studentState.classes.length === 0) {
        container.innerHTML = '<div class="no-data">Classes are loading...</div>';
        return;
    }

    const classBySubject = {};
    studentState.classes.forEach(cls => {
        const subject = cls.subject || inferSubjectFromName(cls.name);
        if (subject && !classBySubject[subject]) {
            classBySubject[subject] = cls;
        }
    });

    const staffById = {};
    (studentState.staffList || []).forEach(staff => {
        staffById[String(staff.id)] = staff;
    });

    container.innerHTML = subjects.map(subject => {
        const cls = classBySubject[subject];
        const hasClass = Boolean(cls && cls.id);
        const enrollment = cls && cls.students
            ? cls.students.find(s => Number(s.id) === Number(studentState.currentUser?.id))
            : null;
        const isEnrolled = Boolean(enrollment);
        const assignedStaff = enrollment && enrollment.staff_id ? staffById[String(enrollment.staff_id)] : null;

        const statusText = !hasClass
            ? 'Class unavailable'
            : isEnrolled
                ? (assignedStaff ? `Assigned staff: ${assignedStaff.name || assignedStaff.email}` : 'Awaiting staff assignment')
                : 'Not enrolled yet';

        const disabledAttr = !hasClass || isEnrolled ? 'disabled' : '';
        const buttonLabel = !hasClass
            ? 'Class Unavailable'
            : isEnrolled ? 'Enrolled' : 'Join Class';

        return `
            <div class="class-card" data-subject="${subject}" data-class-id="${hasClass ? cls.id : ''}">
                <div class="class-title">${getSubjectLabel(subject)} Class</div>
                <div class="class-meta">${statusText}</div>
                <button class="btn btn-primary join-class-btn" ${disabledAttr}>${buttonLabel}</button>
            </div>
        `;
    }).join('');
}

function inferSubjectFromName(name) {
    if (!name) return null;
    const lower = name.toLowerCase();
    if (lower.includes('math')) return 'maths';
    if (lower.includes('bio')) return 'bio';
    if (lower.includes('chem')) return 'chem';
    if (lower.includes('phys')) return 'physics';
    return null;
}

// Render announcements
function renderAnnouncements(announcements) {
    const container = document.getElementById('announcementsContainer');
    container.innerHTML = '';

    if (!announcements || announcements.length === 0) {
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">No announcements at this time</div>';
        return;
    }

    announcements.forEach(ann => {
        const item = document.createElement('div');
        item.className = 'announcement-item';
        
        let fromName = 'Staff';
        let timestamp = '';
        let message = '';
        
        if (typeof ann === 'object' && ann !== null) {
            fromName = ann.from_name || ann.from || 'Staff';
            timestamp = ann.created_at ? new Date(ann.created_at).toLocaleDateString() : '';
            message = ann.message || ann.text || '';
        } else {
            message = String(ann);
        }
        
        item.innerHTML = `
            <div class="announcement-meta">
                From: <strong>${escapeHtml(fromName)}</strong>
                ${timestamp ? ' • ' + timestamp : ''}
            </div>
            <div class="announcement-text">${escapeHtml(message)}</div>
        `;
        container.appendChild(item);
    });
}

// Render grades
function renderGrades(grades) {
    const tbody = document.getElementById('gradesBody');
    tbody.innerHTML = '';

    const subjects = Object.keys(grades);
    
    if (subjects.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="padding: 20px; text-align: center; color: #999;">No grades available yet</td></tr>';
        return;
    }

    subjects.forEach(subject => {
        const tr = document.createElement('tr');
        const gradeData = grades[subject];
        
        let score = '';
        let remarks = '';
        
        if (typeof gradeData === 'object' && gradeData !== null) {
            score = gradeData.score || gradeData.grade || 'N/A';
            remarks = gradeData.remarks || '';
        } else {
            score = gradeData;
        }
        
        tr.innerHTML = `
            <td><strong>${escapeHtml(subject)}</strong></td>
            <td>${escapeHtml(String(score))}</td>
            <td>${escapeHtml(String(remarks || 'N/A'))}</td>
        `;
        tbody.appendChild(tr);
    });
}

// HTML escape helper
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Setup event listeners
function setupEventListeners() {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }

    const classesContainer = document.getElementById('classesContainer');
    if (classesContainer) {
        classesContainer.addEventListener('click', handleClassJoin);
    }
}

// Handle logout
function handleLogout() {
    if (confirm('Are you sure you want to logout?')) {
        // Clear session storage
        sessionStorage.removeItem('current_user');
        sessionStorage.removeItem('auth_token');
        
        // Redirect to login
        window.location.href = 'login.html';
    }
}

async function handleClassJoin(event) {
    const button = event.target.closest('.join-class-btn');
    if (!button) return;

    const card = button.closest('.class-card');
    if (!card) return;

    const classId = card.getAttribute('data-class-id');

    if (!classId) {
        showNotification('Class is not available yet', 'error');
        return;
    }

    await joinClass(classId);
}

async function joinClass(classId) {
    try {
        const response = await apiFetch(`${API_BASE}/api/classes/${classId}/enroll`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${studentState.authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                student_id: studentState.currentUser.id,
                staff_id: null,
                actor_id: studentState.currentUser.id
            })
        });

        if (response.status === 409) {
            showNotification('You are already enrolled in this class', 'info');
            return;
        }

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to enroll');
        }

        showNotification('Class joined successfully! Waiting for staff assignment.', 'success');
        loadClassOptions();
    } catch (error) {
        console.error('Error enrolling:', error);
        showNotification(`Error: ${error.message}`, 'error');
    }
}

// Show notification
function showNotification(message, type = 'info') {
    const toast = document.getElementById('notificationToast');
    if (toast) {
        toast.textContent = message;
        toast.className = `notification-toast ${type} show`;
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    } else {
        // Fallback to alert if no toast element
        alert(message);
    }
}




// Staff Dashboard JavaScript

// Configuration
const API_BASE = 'https://centralized-information-system.onrender.com/';

function apiFetch(url, options = {}) {
    const headers = options.headers ? { ...options.headers } : {};
    const token = staffState.authToken || sessionStorage.getItem('auth_token');
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
const staffState = {
    currentStaff: null,
    authToken: null,
    students: [],
    selectedStudent: null,
    announcements: [],
    selectedStudentIds: new Set(),
    staffSubjects: [],
    allowedSubjects: [],
    classes: []
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    loadAuthData();
    setupEventListeners();
});

// Load authentication data from session
async function loadAuthData() {
    const userStr = sessionStorage.getItem('current_user');
    const token = sessionStorage.getItem('auth_token');
    
    if (!userStr || !token) {
        showNotification('Please login first', 'error');
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 2000);
        return;
    }
    
    const user = JSON.parse(userStr);
    
    // Verify this is a staff/admin
    if (user.role !== 'staff' && user.role !== 'admin') {
        showNotification('Access denied: Staff account required', 'error');
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 2000);
        return;
    }
    
    staffState.currentStaff = user;
    staffState.staffSubjects = normalizeSubjects(user.subjects);
    staffState.authToken = token;
    
    // Update UI with staff info
    document.getElementById('staffName').textContent = user.name || 'Staff';
    document.getElementById('staffRole').textContent = user.role;
    const staffSubjectsEl = document.getElementById('staffSubjects');
    if (staffSubjectsEl) {
        staffSubjectsEl.textContent = 'Subjects: -';
    }
    
    // Load students and data
    await loadStaffProfile();
    await loadStaffClasses();
    await loadStudents();
}

async function loadStaffProfile() {
    try {
        const response = await apiFetch(`${API_BASE}/api/users/${staffState.currentStaff.id}`, {
            headers: {
                'Authorization': `Bearer ${staffState.authToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch staff profile');
        }

        const data = await response.json();
        staffState.currentStaff = data;
        staffState.staffSubjects = normalizeSubjects(data.subjects);

        const staffSubjectsEl = document.getElementById('staffSubjects');
        if (staffSubjectsEl) {
            staffSubjectsEl.textContent = `Subjects: ${formatSubjects(staffState.staffSubjects)}`;
        }
        if (staffState.classes.length > 0) {
            renderStaffClasses();
        }
    } catch (error) {
        console.error('Error loading staff profile:', error);
    }
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
    const list = normalizeSubjects(subjects);
    if (!list || list.length === 0) return 'None';
    const labels = {
        maths: 'Maths',
        bio: 'Bio',
        chem: 'Chem',
        physics: 'Physics'
    };
    return list.map(s => labels[s] || s).join(', ');
}

function getAllowedSubjects(student) {
    if (staffState.currentStaff?.role === 'admin') {
        return normalizeSubjects(student?.subjects);
    }
    const staffSubjects = staffState.staffSubjects.length
        ? staffState.staffSubjects
        : normalizeSubjects(staffState.currentStaff?.subjects);
    const studentSubjects = normalizeSubjects(student?.subjects);
    return staffSubjects.filter(subject => studentSubjects.includes(subject));
}

function updateSubjectRestrictionUI(allowedSubjects) {
    const notice = document.getElementById('subjectRestrictionNotice');
    if (notice) {
        if (!allowedSubjects || allowedSubjects.length === 0) {
            notice.textContent = staffState.currentStaff?.role === 'admin'
                ? 'No subjects assigned to this student.'
                : 'No matching subjects. You can only edit students who take your subjects.';
        } else {
            notice.textContent = `You can edit: ${formatSubjects(allowedSubjects)}`;
        }
    }

    const disabled = staffState.currentStaff?.role !== 'admin' && (!allowedSubjects || allowedSubjects.length === 0);
    ['attendanceInput', 'updateAttendanceBtn', 'updateGradesBtn', 'addGradeRowBtn', 'gradeSubjectSelect'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.disabled = disabled;
        }
    });
}

function filterGradesByAllowed(grades, allowedSubjects) {
    const filtered = {};
    if (!allowedSubjects || allowedSubjects.length === 0) return filtered;
    Object.entries(grades || {}).forEach(([subject, grade]) => {
        if (allowedSubjects.includes(subject)) {
            filtered[subject] = grade;
        }
    });
    return filtered;
}

function populateGradeSubjectSelect(allowedSubjects, grades) {
    const select = document.getElementById('gradeSubjectSelect');
    if (!select) return;

    select.innerHTML = '';
    const existing = grades || {};
    const available = (allowedSubjects || []).filter(subject => !(subject in existing));

    if (available.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No subjects available';
        select.appendChild(option);
        select.disabled = true;
        return;
    }

    select.disabled = false;
    const labels = {
        maths: 'Maths',
        bio: 'Bio',
        chem: 'Chem',
        physics: 'Physics'
    };

    available.forEach(subject => {
        const option = document.createElement('option');
        option.value = subject;
        option.textContent = labels[subject] || subject;
        select.appendChild(option);
    });
}

function getAssignedStudentIds() {
    const assigned = new Set();
    (staffState.classes || []).forEach(cls => {
        (cls.students || []).forEach(student => {
            if (Number(student.staff_id) === Number(staffState.currentStaff?.id)) {
                assigned.add(student.id);
            }
        });
    });
    return assigned;
}

function filterStudentsForStaff(students) {
    if (staffState.currentStaff?.role === 'admin') {
        return students || [];
    }

    const assignedIds = getAssignedStudentIds();
    if (assignedIds.size == 0) {
        return [];
    }

    return (students || []).filter(student => assignedIds.has(student.id));
}

// Load all students
async function loadStudents() {
    try {
        const response = await apiFetch(`${API_BASE}/api/users?role=student`, {
            headers: {
                'Authorization': `Bearer ${staffState.authToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to fetch students');
        }
        
        const allStudents = await response.json();
        staffState.students = filterStudentsForStaff(allStudents);
        const visibleIds = new Set(staffState.students.map(s => s.id));
        staffState.selectedStudentIds.forEach(id => {
            if (!visibleIds.has(id)) {
                staffState.selectedStudentIds.delete(id);
            }
        });
        renderStudentsTable(staffState.students);
        
    } catch (error) {
        console.error('Error loading students:', error);
        showNotification('Failed to load students', 'error');
    }
}

async function loadStaffClasses() {
    try {
        const response = await apiFetch(`${API_BASE}/api/classes`, {
            headers: {
                'Authorization': `Bearer ${staffState.authToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch classes');
        }

        staffState.classes = await response.json();
        renderStaffClasses();
    } catch (error) {
        console.error('Error loading classes:', error);
        const container = document.getElementById('staffClassesContainer');
        if (container) {
            container.innerHTML = '<div class="no-data">Failed to load classes</div>';
        }
    }
}

function inferSubjectFromName(name) {
    if (!name) return null;
    const lower = String(name).toLowerCase();
    if (lower.includes('math')) return 'maths';
    if (lower.includes('bio')) return 'bio';
    if (lower.includes('chem')) return 'chem';
    if (lower.includes('phys')) return 'physics';
    return null;
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

function renderStaffClasses() {
    const container = document.getElementById('staffClassesContainer');
    if (!container) return;

    const staffRole = staffState.currentStaff?.role;
    const staffSubjects = staffRole === 'admin'
        ? []
        : (staffState.staffSubjects.length ? staffState.staffSubjects : normalizeSubjects(staffState.currentStaff?.subjects));

    if (staffRole !== 'admin' && staffSubjects.length === 0) {
        container.innerHTML = '<div class="no-data">No approved subjects assigned yet</div>';
        return;
    }

    const classes = staffState.classes || [];
    const visibleClasses = staffRole === 'admin'
        ? classes
        : classes.filter(cls => {
            const subject = cls.subject || inferSubjectFromName(cls.name);
            return subject && staffSubjects.includes(subject);
        });

    if (visibleClasses.length === 0) {
        container.innerHTML = '<div class="no-data">No classes available</div>';
        return;
    }

    container.innerHTML = visibleClasses.map(cls => {
        const subject = cls.subject || inferSubjectFromName(cls.name);
        const students = (cls.students || []).filter(student => {
            if (staffRole === 'admin') return true;
            return student.staff_id && Number(student.staff_id) === Number(staffState.currentStaff.id);
        });

        const studentsMarkup = students.length
            ? students.map(s => `<div class="class-student">${escapeHtml(s.name || s.email)}</div>`).join('')
            : '<div class="no-data">No students yet</div>';

        return `
            <div class="class-card">
                <div class="class-title">${escapeHtml(cls.name || `${getSubjectLabel(subject)} Class`)}</div>
                <div class="class-meta">Subject: ${escapeHtml(getSubjectLabel(subject) || 'N/A')}</div>
                ${studentsMarkup}
            </div>
        `;
    }).join('');
}

// Setup event listeners
function setupEventListeners() {
    // Search
    const searchInput = document.getElementById('studentSearch');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            filterStudents(this.value);
        });
    }
    
    // Refresh button
    const refreshBtn = document.getElementById('refreshStudents');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', loadStudents);
    }
    
    // Announcement button (modal)
    const annBtn = document.getElementById('sendAnnouncementBtn');
    if (annBtn) {
        annBtn.addEventListener('click', () => sendAnnouncement('single'));
    }

    // Announcement buttons (page)
    const annSelectedBtn = document.getElementById('sendAnnouncementSelectedBtn');
    if (annSelectedBtn) {
        annSelectedBtn.addEventListener('click', () => sendAnnouncement('selected'));
    }
    const annAllBtn = document.getElementById('sendAnnouncementAllBtn');
    if (annAllBtn) {
        annAllBtn.addEventListener('click', () => sendAnnouncement('all'));
    }
    
    // Logout button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
    
    // Modal controls
    const closeBtn = document.querySelector('.close-modal');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeStudentModal);
    }

    // Select all checkbox
    const selectAll = document.getElementById('selectAllStudents');
    if (selectAll) {
        selectAll.addEventListener('change', function() {
            const checkboxes = document.querySelectorAll('.student-select');
            staffState.selectedStudentIds.clear();
            checkboxes.forEach(cb => {
                cb.checked = selectAll.checked;
                if (selectAll.checked) {
                    staffState.selectedStudentIds.add(parseInt(cb.value, 10));
                }
            });
        });
    }

    // Row checkbox changes
    const tbody = document.getElementById('studentsTableBody');
    if (tbody) {
        tbody.addEventListener('change', function(e) {
            const cb = e.target.closest('.student-select');
            if (!cb) return;
            const id = parseInt(cb.value, 10);
            if (cb.checked) {
                staffState.selectedStudentIds.add(id);
            } else {
                staffState.selectedStudentIds.delete(id);
            }
            updateSelectAllState();
        });
    }
    
    // Attendance and grades form
    const updateAttendanceBtn = document.getElementById('updateAttendanceBtn');
    if (updateAttendanceBtn) {
        updateAttendanceBtn.addEventListener('click', updateAttendance);
    }
    
    const updateGradesBtn = document.getElementById('updateGradesBtn');
    if (updateGradesBtn) {
        updateGradesBtn.addEventListener('click', updateGrades);
    }
}

// Filter students
function filterStudents(query) {
    if (!query.trim()) {
        renderStudentsTable(staffState.students);
        return;
    }
    
    const filtered = staffState.students.filter(student => {
        return student.name.toLowerCase().includes(query.toLowerCase()) ||
               student.email.toLowerCase().includes(query.toLowerCase());
    });
    
    renderStudentsTable(filtered);
}

// Render students table
function renderStudentsTable(students) {
    const tbody = document.getElementById('studentsTableBody');
    if (!tbody) return;
    
    if (students.length === 0) {
        const message = staffState.currentStaff?.role === 'admin'
            ? 'No students found'
            : 'No students match your subjects';
        tbody.innerHTML = `<tr><td colspan="5" style="padding: 32px; text-align: center; color: #999;">${message}</td></tr>`;
        return;
    }

    tbody.innerHTML = students.map(student => `
        <tr>
            <td><input type="checkbox" class="student-select" value="${student.id}" ${staffState.selectedStudentIds.has(student.id) ? 'checked' : ''}></td>
            <td><strong>${escapeHtml(student.name)}</strong></td>
            <td>${escapeHtml(student.email)}</td>
            <td>${student.studentData?.attendance || 'N/A'}</td>
            <td>
                <button class="btn btn-primary small" onclick="viewStudentProfile(${student.id})">View Profile</button>
            </td>
        </tr>
    `).join('');

    updateSelectAllState();
}

// View student profile
window.viewStudentProfile = function(studentId) {
    const student = staffState.students.find(s => s.id === studentId);
    if (!student) return;
    
    staffState.selectedStudent = student;
    
    // Populate modal
    document.getElementById('profileName').textContent = student.name;
    document.getElementById('profileEmail').textContent = student.email;
    document.getElementById('profileAttendance').textContent = student.studentData?.attendance || 'N/A';
    const profileSubjects = document.getElementById('profileSubjects');
    if (profileSubjects) {
        profileSubjects.textContent = formatSubjects(student.subjects || []);
    }
    const allowedSubjects = getAllowedSubjects(student);
    staffState.allowedSubjects = allowedSubjects;
    updateSubjectRestrictionUI(allowedSubjects);
    
    // Populate forms
    document.getElementById('attendanceInput').value = student.studentData?.attendance || '';
    
    // Render grades table
    const grades = student.studentData?.grades || {};
    renderStudentGrades(grades);
    populateGradeSubjectSelect(allowedSubjects, grades);
    
    // Show modal
    const modal = document.getElementById('studentModal');
    if (modal) {
        modal.classList.add('open');
    }
};

// Render student grades in modal
function renderStudentGrades(grades) {
    const tbody = document.getElementById('gradesTableBody');
    if (!tbody) return;

    const allowedSubjects = staffState.allowedSubjects || [];
    const filteredGrades = filterGradesByAllowed(grades || {}, allowedSubjects);

    if (!allowedSubjects.length) {
        tbody.innerHTML = '<tr><td colspan="3" style="padding: 16px; text-align: center; color: #999;">No matching subjects for this student</td></tr>';
        return;
    }

    if (Object.keys(filteredGrades).length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="padding: 16px; text-align: center; color: #999;">No grades recorded for your subjects</td></tr>';
        return;
    }
    
    tbody.innerHTML = Object.entries(filteredGrades).map(([subject, grade]) => {
        const value = typeof grade === 'object' && grade !== null
            ? (grade.score ?? grade.grade ?? '')
            : grade;
        return `
        <tr>
            <td>${escapeHtml(subject)}</td>
            <td>
                <input type="number" class="grade-input" value="${escapeHtml(String(value ?? ''))}" data-subject="${subject}" min="0" max="100">
            </td>
            <td>
                <button class="btn btn-secondary small" onclick="removeGrade('${escapeHtml(subject)}')">Remove</button>
            </td>
        </tr>
        `;
    }).join('');
}

// Add new grade row
window.addGradeRow = function() {
    if (!staffState.selectedStudent) return;
    const allowedSubjects = staffState.allowedSubjects || [];
    if (!allowedSubjects.length) {
        showNotification('You cannot add grades for this student', 'error');
        return;
    }

    const select = document.getElementById('gradeSubjectSelect');
    const subject = select ? select.value : '';
    if (!subject) {
        showNotification('No available subjects to add', 'error');
        return;
    }
    
    if (!staffState.selectedStudent.studentData) {
        staffState.selectedStudent.studentData = {};
    }
    if (!staffState.selectedStudent.studentData.grades) {
        staffState.selectedStudent.studentData.grades = {};
    }
    
    if (!(subject in staffState.selectedStudent.studentData.grades)) {
        staffState.selectedStudent.studentData.grades[subject] = 0;
    }
    renderStudentGrades(staffState.selectedStudent.studentData.grades);
    populateGradeSubjectSelect(allowedSubjects, staffState.selectedStudent.studentData.grades);
};

// Remove grade
window.removeGrade = function(subject) {
    const allowedSubjects = staffState.allowedSubjects || [];
    if (!allowedSubjects.includes(subject)) {
        showNotification('You can only edit grades for your subjects', 'error');
        return;
    }
    if (staffState.selectedStudent.studentData.grades) {
        delete staffState.selectedStudent.studentData.grades[subject];
        renderStudentGrades(staffState.selectedStudent.studentData.grades);
        populateGradeSubjectSelect(allowedSubjects, staffState.selectedStudent.studentData.grades);
    }
};

// Update attendance
async function updateAttendance() {
    if (!staffState.selectedStudent) return;
    const allowedSubjects = staffState.allowedSubjects || [];
    if (staffState.currentStaff?.role !== 'admin' && !allowedSubjects.length) {
        showNotification('You cannot update attendance for this student', 'error');
        return;
    }
    
    const attendance = document.getElementById('attendanceInput').value.trim();
    
    if (!attendance) {
        showNotification('Please enter attendance', 'error');
        return;
    }
    
    try {
        const response = await apiFetch(`${API_BASE}/api/students/${staffState.selectedStudent.id}/attendance`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${staffState.authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                attendance: attendance,
                actor_id: staffState.currentStaff.id
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to update attendance');
        }
        
        staffState.selectedStudent.studentData.attendance = attendance;
        showNotification('Attendance updated successfully!', 'success');
        loadStudents();
        
    } catch (error) {
        console.error('Error:', error);
        showNotification('Error updating attendance: ' + error.message, 'error');
    }
}

// Update grades
async function updateGrades() {
    if (!staffState.selectedStudent) return;
    const allowedSubjects = staffState.allowedSubjects || [];
    if (staffState.currentStaff?.role !== 'admin' && !allowedSubjects.length) {
        showNotification('You cannot update grades for this student', 'error');
        return;
    }
    
    const gradeInputs = document.querySelectorAll('.grade-input');
    const existingGrades = staffState.selectedStudent.studentData?.grades || {};
    const grades = { ...existingGrades };
    let touchedCount = 0;
    
    gradeInputs.forEach(input => {
        const subject = input.dataset.subject;
        const grade = parseFloat(input.value) || 0;
        if (allowedSubjects.includes(subject)) {
            grades[subject] = grade;
            touchedCount += 1;
        }
    });
    
    if (touchedCount === 0) {
        showNotification('Please add at least one grade for your subjects', 'error');
        return;
    }
    
    try {
        const response = await apiFetch(`${API_BASE}/api/students/${staffState.selectedStudent.id}/grades`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${staffState.authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                grades: grades,
                actor_id: staffState.currentStaff.id
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to update grades');
        }
        
        staffState.selectedStudent.studentData.grades = grades;
        showNotification('Grades updated successfully!', 'success');
        renderStudentGrades(grades);
        loadStudents();
        
    } catch (error) {
        console.error('Error:', error);
        showNotification('Error updating grades: ' + error.message, 'error');
    }
}

// Send announcement to student
async function sendAnnouncement(mode) {
    let message = '';
    let targetIds = [];

    if (mode === 'single') {
        if (!staffState.selectedStudent) {
            showNotification('Please select a student first', 'error');
            return;
        }
        message = document.getElementById('announcementInput').value.trim();
        targetIds = [staffState.selectedStudent.id];
    } else {
        message = document.getElementById('announcementInputPage').value.trim();
        if (mode === 'selected') {
            targetIds = Array.from(staffState.selectedStudentIds);
        } else if (mode === 'all') {
            targetIds = staffState.students.map(s => s.id);
        }
    }

    if (!message) {
        showNotification('Please enter an announcement', 'error');
        return;
    }
    if (!targetIds.length) {
        showNotification('Please select at least one student', 'error');
        return;
    }
    
    try {
        const response = await apiFetch(`${API_BASE}/api/announcements`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${staffState.authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from_user_id: staffState.currentStaff.id,
                to_user_ids: targetIds,
                text: message
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to send announcement');
        }
        
        if (mode === 'single') {
            document.getElementById('announcementInput').value = '';
        } else {
            document.getElementById('announcementInputPage').value = '';
        }
        showNotification('Announcement sent successfully!', 'success');
        
    } catch (error) {
        console.error('Error:', error);
        showNotification('Error sending announcement: ' + error.message, 'error');
    }
}

function updateSelectAllState() {
    const selectAll = document.getElementById('selectAllStudents');
    if (!selectAll) return;
    const total = staffState.students.length;
    const selected = staffState.selectedStudentIds.size;
    selectAll.checked = total > 0 && selected === total;
    selectAll.indeterminate = selected > 0 && selected < total;
}

// Close student modal
function closeStudentModal() {
    const modal = document.getElementById('studentModal');
    if (modal) {
        modal.classList.remove('open');
    }
    staffState.selectedStudent = null;
    staffState.allowedSubjects = [];
}

// Handle logout
function handleLogout() {
    if (confirm('Are you sure you want to logout?')) {
        sessionStorage.removeItem('current_user');
        sessionStorage.removeItem('auth_token');
        window.location.href = 'login.html';
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
        alert(message);
    }
}

// HTML escape helper
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}


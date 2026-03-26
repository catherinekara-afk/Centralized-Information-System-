// Admin Panel JavaScript

// Configuration
const API_BASE = 'https://centralized-information-system.onrender.com/';
const SUBJECT_OPTIONS = [
    { value: 'maths', label: 'Maths' },
    { value: 'bio', label: 'Bio' },
    { value: 'chem', label: 'Chem' },
    { value: 'physics', label: 'Physics' }
];

// Data storage
const adminData = {
    students: [],
    staff: [],
    admins: [],
    pending: [],
    classes: [],
    studentReport: [],
    staffActivities: [],
    activityLog: [],
    currentUser: null,
    authToken: null
};

// Initialize admin panel
document.addEventListener('DOMContentLoaded', function() {
    initializeAdminPanel();
    setupEventListeners();
    loadAuthData();
});

// Initialize admin panel
function initializeAdminPanel() {
    console.log('Admin Panel Initialized');
}

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
    
    // Verify this is an admin
    if (user.role !== 'admin') {
        showNotification('Access denied: Admin account required', 'error');
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 2000);
        return;
    }
    
    adminData.currentUser = user;
    adminData.authToken = token;
    
    // Update UI with user info
    document.querySelector('.user-profile span').textContent = user.name || user.email;
    
    // Load data from backend
    loadDataFromBackend();
}

// Setup event listeners
function setupEventListeners() {
    // Navigation
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', handleNavigation);
    });

    // Add buttons
    document.getElementById('addStudentBtn').addEventListener('click', () => openModal('student'));
    document.getElementById('addStaffBtn').addEventListener('click', () => openModal('staff'));
    document.getElementById('addAdminBtn').addEventListener('click', () => openModal('admin'));

    // Search and filter
    document.getElementById('studentSearch').addEventListener('input', filterStudents);
    document.getElementById('staffSearch').addEventListener('input', filterStaff);
    document.getElementById('adminSearch').addEventListener('input', filterAdmins);

    document.getElementById('studentFilter').addEventListener('change', filterStudents);
    document.getElementById('staffFilter').addEventListener('change', filterStaff);
    document.getElementById('adminFilter').addEventListener('change', filterAdmins);

    // Modal controls
    document.querySelector('.close-modal').addEventListener('click', closeModal);
    document.querySelector('.close-modal-btn').addEventListener('click', closeModal);
    document.getElementById('recordForm').addEventListener('submit', handleFormSubmit);

    // Pending approvals actions
    const approvalsBody = document.getElementById('approvalsTableBody');
    if (approvalsBody) {
        approvalsBody.addEventListener('click', handleApprovalAction);
    }

    // Report actions
    const loadStudentReportBtn = document.getElementById('loadStudentReportBtn');
    if (loadStudentReportBtn) {
        loadStudentReportBtn.addEventListener('click', loadStudentReport);
    }
    const saveStaffActivityBtn = document.getElementById('saveStaffActivityBtn');
    if (saveStaffActivityBtn) {
        saveStaffActivityBtn.addEventListener('click', saveStaffActivity);
    }


    // Settings actions
    const loadAuditBtn = document.getElementById('loadAuditBtn');
    if (loadAuditBtn) {
        loadAuditBtn.addEventListener('click', loadAuditLogs);
    }
    const changePasswordBtn = document.getElementById('changePasswordBtn');
    if (changePasswordBtn) {
        changePasswordBtn.addEventListener('click', changePassword);
    }


    const downloadBackupBtn = document.getElementById('downloadBackupBtn');
    if (downloadBackupBtn) {
        downloadBackupBtn.addEventListener('click', downloadBackup);
    }
    const restoreBackupBtn = document.getElementById('restoreBackupBtn');
    if (restoreBackupBtn) {
        restoreBackupBtn.addEventListener('click', restoreBackup);
    }

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);

    // Menu toggle for mobile
    document.getElementById('menuToggle').addEventListener('click', toggleMenu);
}

// Handle navigation
function handleNavigation(e) {
    e.preventDefault();
    const section = e.target.getAttribute('data-section');
    
    // Hide all sections
    document.querySelectorAll('.section-content').forEach(s => {
        s.classList.remove('active');
    });

    // Remove active class from all nav links
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
    });

    // Show selected section
    document.getElementById(section).classList.add('active');
    e.target.classList.add('active');

    // Update page title
    const titles = {
        'dashboard': 'Dashboard',
        'students': 'Manage Students',
        'staff': 'Manage Staff',
        'admins': 'Manage Admin Members',
        'approvals': 'Pending Approvals',
        'reports': 'Reports',
        'settings': 'Settings'
    };
    document.getElementById('pageTitle').textContent = titles[section];
}

// Load data from backend API
async function loadDataFromBackend() {
    try {
        // Fetch all users
        const response = await fetch(`${API_BASE}/api/users`, {
            headers: {
                'Authorization': `Bearer ${adminData.authToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to fetch users');
        }
        
        const users = await response.json();
        const approvedUsers = users.filter(u => u.approved === 1 || u.approved === true);
        
        // Separate by role (approved only)
        adminData.students = approvedUsers.filter(u => u.role === 'student');
        adminData.staff = approvedUsers.filter(u => u.role === 'staff');
        adminData.admins = approvedUsers.filter(u => u.role === 'admin');
        
        // Add enrollment date if available
        adminData.students = adminData.students.map(s => ({
            ...s,
            class: 'N/A',
            date: s.created_at ? new Date(s.created_at).toISOString().split('T')[0] : 'N/A',
            status: s.disabled ? 'inactive' : 'active'
        }));
        
        adminData.staff = adminData.staff.map(s => ({
            ...s,
            department: 'administrative',
            position: 'Staff Member',
            status: s.disabled ? 'inactive' : 'active'
        }));
        
        adminData.admins = adminData.admins.map(a => ({
            ...a,
            role: 'admin',
            permissions: 'All',
            status: a.disabled ? 'inactive' : 'active'
        }));

        // Fetch pending approvals
        try {
            const pendingResponse = await fetch(`${API_BASE}/api/users/pending`, {
                headers: {
                    'Authorization': `Bearer ${adminData.authToken}`,
                    'Content-Type': 'application/json'
                }
            });
            if (pendingResponse.ok) {
                adminData.pending = await pendingResponse.json();
            } else {
                adminData.pending = users.filter(u => !(u.approved === 1 || u.approved === true));
            }
        } catch (err) {
            console.error('Error fetching pending approvals:', err);
            adminData.pending = users.filter(u => !(u.approved === 1 || u.approved === true));
        }
        
        // Add to activity log
        adminData.activityLog.unshift({
            action: 'Dashboard loaded',
            timestamp: new Date()
        });

        // Load report metadata if reports UI is present
        loadReportMetadata();
        
        renderTables();
        updateDashboard();
        loadAuditLogs();
        
    } catch (error) {
        console.error('Error loading data:', error);
        showNotification('Failed to load data from server', 'error');
        
        // Fallback to empty state
        renderTables();
        updateDashboard();
    }
}

// Render all tables
function renderTables() {
    renderStudentsTable(adminData.students);
    renderStaffTable(adminData.staff);
    renderAdminsTable(adminData.admins);
    renderApprovalsTable(adminData.pending);
    renderActivityLog();
}

function buildSubjectCheckboxes(selected = []) {
    const selectedSet = new Set(selected || []);
    return SUBJECT_OPTIONS.map(opt => {
        const checked = selectedSet.has(opt.value) ? 'checked' : '';
        return `
            <label class="subject-choice">
                <input type="checkbox" name="subjects" value="${opt.value}" ${checked}>
                <span>${opt.label}</span>
            </label>
        `;
    }).join('');
}

// Render students table
function renderStudentsTable(students) {
    const tbody = document.getElementById('studentsTableBody');
    
    if (students.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="7" class="empty-state">No students found</td></tr>';
        return;
    }

    tbody.innerHTML = students.map(student => `
        <tr>
            <td>${student.id}</td>
            <td>${student.name}</td>
            <td>${student.email}</td>
            <td>${student.class}</td>
            <td><span class="status-badge ${student.status}">${student.status.charAt(0).toUpperCase() + student.status.slice(1)}</span></td>
            <td>${student.date}</td>
            <td>
                <div class="table-actions">
                    <button class="btn-view" onclick="viewRecord('student', ${student.id})">View</button>
                    <button class="btn-edit" onclick="editRecord('student', ${student.id})">Edit</button>
                    <button class="btn-delete" onclick="deleteRecord('student', ${student.id})">Delete</button>
                </div>
            </td>
        </tr>
    `).join('');
}

// Render staff table
function renderStaffTable(staff) {
    const tbody = document.getElementById('staffTableBody');
    
    if (staff.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="7" class="empty-state">No staff members found</td></tr>';
        return;
    }

    tbody.innerHTML = staff.map(member => `
        <tr>
            <td>${member.id}</td>
            <td>${member.name}</td>
            <td>${member.email}</td>
            <td>${member.department}</td>
            <td>${member.position}</td>
            <td><span class="status-badge ${member.status}">${member.status.charAt(0).toUpperCase() + member.status.slice(1)}</span></td>
            <td>
                <div class="table-actions">
                    <button class="btn-view" onclick="viewRecord('staff', ${member.id})">View</button>
                    <button class="btn-edit" onclick="editRecord('staff', ${member.id})">Edit</button>
                    <button class="btn-delete" onclick="deleteRecord('staff', ${member.id})">Delete</button>
                </div>
            </td>
        </tr>
    `).join('');
}

// Render admins table
function renderAdminsTable(admins) {
    const tbody = document.getElementById('adminsTableBody');
    
    if (admins.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="7" class="empty-state">No admin members found</td></tr>';
        return;
    }

    tbody.innerHTML = admins.map(admin => `
        <tr>
            <td>${admin.id}</td>
            <td>${admin.name}</td>
            <td>${admin.email}</td>
            <td>${admin.role}</td>
            <td>${admin.permissions}</td>
            <td><span class="status-badge ${admin.status}">${admin.status.charAt(0).toUpperCase() + admin.status.slice(1)}</span></td>
            <td>
                <div class="table-actions">
                    <button class="btn-view" onclick="viewRecord('admin', ${admin.id})">View</button>
                    <button class="btn-edit" onclick="editRecord('admin', ${admin.id})">Edit</button>
                    <button class="btn-delete" onclick="deleteRecord('admin', ${admin.id})">Delete</button>
                </div>
            </td>
        </tr>
    `).join('');
}

// Render approvals table
function renderApprovalsTable(pendingUsers) {
    const tbody = document.getElementById('approvalsTableBody');
    if (!tbody) return;
    
    if (!pendingUsers || pendingUsers.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="7" class="empty-state">No pending approvals</td></tr>';
        return;
    }
    
    tbody.innerHTML = pendingUsers.map(user => {
        const requestedRole = user.requested_role || user.role || 'student';
        const createdAt = user.created_at ? new Date(user.created_at).toISOString().split('T')[0] : 'N/A';
        return `
            <tr>
                <td>${user.id}</td>
                <td>${user.name}</td>
                <td>${user.email}</td>
                <td>${requestedRole}</td>
                <td>
                    <select class="role-select" data-role-for="${user.id}">
                        <option value="student" ${requestedRole === 'student' ? 'selected' : ''}>Student</option>
                        <option value="staff" ${requestedRole === 'staff' ? 'selected' : ''}>Staff</option>
                        <option value="admin" ${requestedRole === 'admin' ? 'selected' : ''}>Admin</option>
                    </select>
                </td>
                <td>${createdAt}</td>
                <td>
                    <div class="table-actions">
                        <button class="btn-approve" data-user-id="${user.id}">Approve</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// Render activity log
function renderActivityLog() {
    const logContainer = document.getElementById('activityLog');
    
    if (adminData.activityLog.length === 0) {
        logContainer.innerHTML = '<p class="empty-state">No recent activity</p>';
        return;
    }

    logContainer.innerHTML = adminData.activityLog.map(activity => `
        <div class="activity-item">
            <p>${activity.action}</p>
            <span class="activity-time">${activity.timestamp.toLocaleString()}</span>
        </div>
    `).join('');
}

// Update dashboard stats
async function updateDashboard() {
    document.getElementById('totalStudents').textContent = adminData.students.length;
    document.getElementById('totalStaff').textContent = adminData.staff.length;
    document.getElementById('totalAdmins').textContent = adminData.admins.length;
    
    try {
        // Fetch statistics from backend
        const response = await fetch(`${API_BASE}/api/stats`, {
            headers: {
                'Authorization': `Bearer ${adminData.authToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            const stats = await response.json();
            document.getElementById('totalStudents').textContent = stats.users.student || 0;
            document.getElementById('totalStaff').textContent = stats.users.staff || 0;
            document.getElementById('totalAdmins').textContent = stats.users.admin || 0;
            document.getElementById('pendingApprovals').textContent = stats.pending_approvals || 0;
        }
    } catch (error) {
        console.error('Error fetching stats:', error);
        // Fallback to local data
        document.getElementById('totalStudents').textContent = adminData.students.length;
        document.getElementById('totalStaff').textContent = adminData.staff.length;
        document.getElementById('totalAdmins').textContent = adminData.admins.length;
        document.getElementById('pendingApprovals').textContent = adminData.pending.length;
    }
}

// Report metadata loader
function loadReportMetadata() {
    if (document.getElementById('reportClassFilter')) {
        loadClassesForReport();
    }
    if (document.getElementById('staffActivityTableBody')) {
        populateStaffDropdown();
        loadStaffActivities();
    }
}

async function loadClassesForReport() {
    try {
        const response = await fetch(`${API_BASE}/api/classes`, {
            headers: {
                'Authorization': `Bearer ${adminData.authToken}`,
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) {
            throw new Error('Failed to fetch classes');
        }
        adminData.classes = await response.json();
        const select = document.getElementById('reportClassFilter');
        if (select) {
            select.innerHTML = '<option value=\"\">All Classes</option>' +
                adminData.classes.map(c => `<option value=\"${c.id}\">${c.name}</option>`).join('');
        }
    } catch (error) {
        console.error('Error loading classes:', error);
    }
}

function populateStaffDropdown() {
    const select = document.getElementById('staffActivityStaff');
    if (!select) return;
    select.innerHTML = '<option value=\"\">Select Staff</option>' +
        adminData.staff.map(s => `<option value=\"${s.id}\">${s.name || s.email}</option>`).join('');
}

async function loadStudentReport() {
    try {
        const classFilter = document.getElementById('reportClassFilter');
        const classId = classFilter ? classFilter.value : '';
        const url = classId ? `${API_BASE}/api/reports/student-summary?class_id=${classId}` : `${API_BASE}/api/reports/student-summary`;
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${adminData.authToken}`,
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) {
            throw new Error('Failed to fetch student report');
        }
        adminData.studentReport = await response.json();
        renderStudentReportTable(adminData.studentReport);
    } catch (error) {
        console.error('Error loading student report:', error);
        showNotification('Failed to load student report', 'error');
    }
}

function renderStudentReportTable(rows) {
    const tbody = document.getElementById('studentReportTableBody');
    if (!tbody) return;
    if (!rows || rows.length === 0) {
        tbody.innerHTML = '<tr class=\"empty-row\"><td colspan=\"6\" class=\"empty-state\">No data found</td></tr>';
        return;
    }
    tbody.innerHTML = rows.map(r => `
        <tr>
            <td>${r.name || ''}</td>
            <td>${r.email || ''}</td>
            <td>${r.classes || 'N/A'}</td>
            <td>${r.attendance || 'N/A'}</td>
            <td>${formatGrades(r.grades)}</td>
            <td>${formatFee(r.fee_balance)}</td>
        </tr>
    `).join('');
}

function formatGrades(grades) {
    if (!grades) return 'N/A';
    if (typeof grades === 'string') return grades;
    const entries = Object.entries(grades);
    if (entries.length === 0) return 'N/A';
    return entries.map(([k, v]) => `${k}: ${v}`).join(', ');
}

function formatFee(val) {
    if (val === null || val === undefined || val === '') return '0.00';
    const num = Number(val);
    if (Number.isNaN(num)) return String(val);
    return num.toFixed(2);
}

async function loadStaffActivities() {
    try {
        const response = await fetch(`${API_BASE}/api/reports/staff-activities`, {
            headers: {
                'Authorization': `Bearer ${adminData.authToken}`,
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) {
            throw new Error('Failed to fetch staff activities');
        }
        adminData.staffActivities = await response.json();
        renderStaffActivitiesTable(adminData.staffActivities);
    } catch (error) {
        console.error('Error loading staff activities:', error);
    }
}

function renderStaffActivitiesTable(rows) {
    const tbody = document.getElementById('staffActivityTableBody');
    if (!tbody) return;
    if (!rows || rows.length === 0) {
        tbody.innerHTML = '<tr class=\"empty-row\"><td colspan=\"5\" class=\"empty-state\">No staff activity data</td></tr>';
        return;
    }
    tbody.innerHTML = rows.map(r => `
        <tr>
            <td>${r.staff_name || r.staff_email || 'N/A'}</td>
            <td>${r.class_name || 'N/A'}</td>
            <td>${r.lectures_taken ?? 0}</td>
            <td>${r.lectures_missed ?? 0}</td>
            <td>${r.updated_at ? new Date(r.updated_at).toLocaleString() : 'N/A'}</td>
        </tr>
    `).join('');
}

async function saveStaffActivity() {
    const staffId = document.getElementById('staffActivityStaff')?.value;
    const className = document.getElementById('staffActivityClass')?.value.trim();
    const taken = document.getElementById('staffActivityTaken')?.value;
    const missed = document.getElementById('staffActivityMissed')?.value;
    
    if (!staffId || !className) {
        showNotification('Select staff and enter class name', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/reports/staff-activities`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${adminData.authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                staff_id: staffId,
                class_name: className,
                lectures_taken: Number(taken || 0),
                lectures_missed: Number(missed || 0)
            })
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to save staff activity');
        }
        showNotification('Staff activity saved', 'success');
        loadStaffActivities();
    } catch (error) {
        console.error('Error saving staff activity:', error);
        showNotification('Failed to save staff activity', 'error');
    }
}

// Filter students
function filterStudents() {
    const searchTerm = document.getElementById('studentSearch').value.toLowerCase();
    const filterStatus = document.getElementById('studentFilter').value;

    let filtered = adminData.students.filter(student => {
        const matchesSearch = student.name.toLowerCase().includes(searchTerm) ||
                            student.email.toLowerCase().includes(searchTerm);
        const matchesFilter = filterStatus === '' || student.status === filterStatus;
        return matchesSearch && matchesFilter;
    });

    renderStudentsTable(filtered);
}

// Filter staff
function filterStaff() {
    const searchTerm = document.getElementById('staffSearch').value.toLowerCase();
    const filterDept = document.getElementById('staffFilter').value;

    let filtered = adminData.staff.filter(member => {
        const matchesSearch = member.name.toLowerCase().includes(searchTerm) ||
                            member.email.toLowerCase().includes(searchTerm);
        const matchesFilter = filterDept === '' || member.department === filterDept;
        return matchesSearch && matchesFilter;
    });

    renderStaffTable(filtered);
}

// Filter admins
function filterAdmins() {
    const searchTerm = document.getElementById('adminSearch').value.toLowerCase();
    const filterRole = document.getElementById('adminFilter').value;

    let filtered = adminData.admins.filter(admin => {
        const matchesSearch = admin.name.toLowerCase().includes(searchTerm) ||
                            admin.email.toLowerCase().includes(searchTerm);
        const matchesFilter = filterRole === '' || admin.role === filterRole;
        return matchesSearch && matchesFilter;
    });

    renderAdminsTable(filtered);
}

// Open modal for adding/editing
function openModal(type) {
    const modal = document.getElementById('recordModal');
    const modalTitle = document.getElementById('modalTitle');
    const formFields = document.getElementById('formFields');

    const formTemplates = {
        student: `
            <div class="form-group">
                <label>Full Name</label>
                <input type="text" name="name" required>
            </div>
            <div class="form-group">
                <label>Email</label>
                <input type="email" name="email" required>
            </div>
            <div class="form-group">
                <label>Class</label>
                <select name="class">
                    <option>10A</option>
                    <option>10B</option>
                    <option>11A</option>
                    <option>11B</option>
                </select>
            </div>
            <p style="font-size: 0.85rem; color: #999; margin-top: 10px;">Default password will be sent to email</p>
        `,
        staff: `
            <div class="form-group">
                <label>Full Name</label>
                <input type="text" name="name" required>
            </div>
            <div class="form-group">
                <label>Email</label>
                <input type="email" name="email" required>
            </div>
            <div class="form-group">
                <label>Department</label>
                <select name="department">
                    <option value="teaching">Teaching</option>
                    <option value="administrative">Administrative</option>
                    <option value="support">Support</option>
                </select>
            </div>
            <div class="form-group">
                <label>Position</label>
                <input type="text" name="position">
            </div>
            <p style="font-size: 0.85rem; color: #999; margin-top: 10px;">Default password will be sent to email</p>
        `,
        admin: `
            <div class="form-group">
                <label>Full Name</label>
                <input type="text" name="name" required>
            </div>
            <div class="form-group">
                <label>Email</label>
                <input type="email" name="email" required>
            </div>
            <p style="font-size: 0.85rem; color: #999; margin-top: 10px;">Default password will be sent to email</p>
        `
    };

    const titles = {
        'student': 'Add New Student',
        'staff': 'Add New Staff Member',
        'admin': 'Add New Admin Member'
    };

    modalTitle.textContent = titles[type];
    formFields.innerHTML = formTemplates[type];
    
    // Store the type in the form for processing
    const recordForm = document.getElementById('recordForm');
    recordForm.dataset.type = type;
    recordForm.dataset.mode = 'create';
    recordForm.dataset.recordId = '';
    
    modal.classList.add('open');
}


function openEditModal(type, record) {
    const modal = document.getElementById('recordModal');
    const modalTitle = document.getElementById('modalTitle');
    const formFields = document.getElementById('formFields');

    if (!record) {
        showNotification('Record not found', 'error');
        return;
    }

    const statusValue = record.status || (record.disabled ? 'inactive' : 'active');
    const subjectSection = (type === 'student' || type === 'staff') ? `
        <div class="form-group">
            <label>Subjects</label>
            <div class="subject-choices">${buildSubjectCheckboxes(record.subjects || [])}</div>
        </div>
    ` : '';

    formFields.innerHTML = `
        <div class="form-group">
            <label>Full Name</label>
            <input type="text" name="name" required value="${record.name || ''}">
        </div>
        <div class="form-group">
            <label>Email</label>
            <input type="email" name="email" required value="${record.email || ''}">
        </div>
        <div class="form-group">
            <label>Status</label>
            <select name="status">
                <option value="active" ${statusValue === 'active' ? 'selected' : ''}>Active</option>
                <option value="inactive" ${statusValue === 'inactive' ? 'selected' : ''}>Inactive</option>
            </select>
        </div>
        ${subjectSection}
    `;

    modalTitle.textContent = `Edit ${type === 'staff' ? 'Staff' : 'Student'}`;
    const form = document.getElementById('recordForm');
    form.dataset.type = type;
    form.dataset.mode = 'edit';
    form.dataset.recordId = record.id;
    modal.classList.add('open');
}


// Close modal
function closeModal() {
    const modal = document.getElementById('recordModal');
    modal.classList.remove('open');
    const form = document.getElementById('recordForm');
    form.reset();
    form.dataset.mode = 'create';
    form.dataset.recordId = '';
}


function getSubjectLabel(subject) {
    const match = SUBJECT_OPTIONS.find(opt => opt.value === subject);
    return match ? match.label : subject;
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

async function ensureClassesLoaded() {
    if (adminData.classes && adminData.classes.length > 0) return;
    try {
        const response = await fetch(`${API_BASE}/api/classes`, {
            headers: {
                'Authorization': `Bearer ${adminData.authToken}`,
                'Content-Type': 'application/json'
            }
        });
        if (response.ok) {
            adminData.classes = await response.json();
        }
    } catch (error) {
        console.error('Error loading classes:', error);
    }
}

async function openAssignStaffModal(studentId) {
    const student = adminData.students.find(s => s.id === studentId);
    if (!student) {
        showNotification('Student not found', 'error');
        return;
    }

    adminData.assignStudentId = studentId;
    const nameEl = document.getElementById('assignStudentName');
    if (nameEl) {
        nameEl.textContent = `${student.name} (${student.email})`;
    }

    await ensureClassesLoaded();
    renderAssignRows(student);

    const modal = document.getElementById('assignModal');
    if (modal) {
        modal.classList.add('open');
    }
}

function closeAssignModal() {
    const modal = document.getElementById('assignModal');
    if (modal) {
        modal.classList.remove('open');
    }
    adminData.assignStudentId = null;
}

function renderAssignRows(student) {
    const container = document.getElementById('assignSubjectsContainer');
    if (!container) return;

    const subjects = normalizeSubjects(student.subjects || []);
    if (!subjects.length) {
        container.innerHTML = '<div class="empty-state">No approved subjects to assign.</div>';
        return;
    }

    const classBySubject = {};
    (adminData.classes || []).forEach(cls => {
        const subject = cls.subject || inferSubjectFromName(cls.name);
        if (subject && !classBySubject[subject]) {
            classBySubject[subject] = cls;
        }
    });

    const staffById = {};
    adminData.staff.forEach(staff => {
        staffById[String(staff.id)] = staff;
    });

    container.innerHTML = subjects.map(subject => {
        const cls = classBySubject[subject];
        const classId = cls ? cls.id : '';
        const enrollment = cls && cls.students
            ? cls.students.find(s => Number(s.id) === Number(student.id))
            : null;
        const currentStaffId = enrollment && enrollment.staff_id ? String(enrollment.staff_id) : '';

        const staffForSubject = adminData.staff.filter(staff => {
            const staffSubjects = normalizeSubjects(staff.subjects);
            return staffSubjects.includes(subject);
        });

        const hasStaff = staffForSubject.length > 0;
        const disabledAttr = !classId || !hasStaff ? 'disabled' : '';

        const staffOptions = staffForSubject.map(staff => {
            const selected = String(staff.id) === currentStaffId ? 'selected' : '';
            return `<option value="${staff.id}" ${selected}>${staff.name || staff.email}</option>`;
        }).join('');

        const options = hasStaff
            ? `<option value="" ${currentStaffId === '' ? 'selected' : ''}>Unassigned</option>${staffOptions}`
            : '<option value="" selected>No staff available</option>';

        const currentLabel = currentStaffId && staffById[currentStaffId]
            ? (staffById[currentStaffId].name || staffById[currentStaffId].email)
            : 'Unassigned';

        const classNote = classId ? '' : 'Class not available yet.';

        return `
            <div class="assign-row" data-class-id="${classId}" data-current-staff="${currentStaffId}" data-subject="${subject}">
                <div class="assign-subject">${getSubjectLabel(subject)}</div>
                <select class="assign-staff-select" ${disabledAttr}>${options}</select>
                <div class="assign-meta">Current: ${currentLabel}${classNote ? ' ? ' + classNote : ''}</div>
            </div>
        `;
    }).join('');
}

async function saveAssignStaff() {
    const studentId = adminData.assignStudentId;
    if (!studentId) {
        showNotification('Select a student first', 'error');
        return;
    }

    const rows = document.querySelectorAll('#assignSubjectsContainer .assign-row');
    const requests = [];

    rows.forEach(row => {
        const classId = row.getAttribute('data-class-id');
        if (!classId) return;
        const select = row.querySelector('.assign-staff-select');
        if (!select) return;
        const newStaff = select.value || '';
        const currentStaff = row.getAttribute('data-current-staff') || '';
        if (newStaff === currentStaff) return;

        requests.push(fetch(`${API_BASE}/api/classes/${classId}/enroll`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${adminData.authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                student_id: studentId,
                staff_id: newStaff || null,
                actor_id: adminData.currentUser ? adminData.currentUser.id : null
            })
        }));
    });

    if (requests.length === 0) {
        showNotification('No changes to save', 'info');
        return;
    }

    try {
        const responses = await Promise.all(requests);
        for (const res of responses) {
            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.error || 'Failed to save assignments');
            }
        }
        showNotification('Staff assignments updated', 'success');
        closeAssignModal();
        loadDataFromBackend();
    } catch (error) {
        console.error('Assign staff error:', error);
        showNotification(`Error: ${error.message}`, 'error');
    }
}

// Handle form submission
async function handleFormSubmit(e) {
    e.preventDefault();
    
    const formEl = document.getElementById('recordForm');
    const type = formEl.dataset.type;
    const mode = formEl.dataset.mode || 'create';
    const formData = new FormData(formEl);
    const newRecord = Object.fromEntries(formData);
    
    // Validate required fields
    if (!newRecord.name || !newRecord.email) {
        showNotification('Name and email are required', 'error');
        return;
    }

    if (mode === 'edit') {
        const recordId = formEl.dataset.recordId;
        const subjectInputs = formEl.querySelectorAll('input[name="subjects"]:checked');
        const subjects = Array.from(subjectInputs).map(input => input.value);
        const statusValue = formData.get('status') || 'active';

        try {
            const response = await fetch(`${API_BASE}/api/users/${recordId}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${adminData.authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: newRecord.name,
                    email: newRecord.email,
                    disabled: statusValue === 'inactive',
                    subjects: subjects,
                    actor_id: adminData.currentUser ? adminData.currentUser.id : null
                })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to update user');
            }

            adminData.activityLog.unshift({
                action: `Updated ${type} record: ${newRecord.name}`,
                timestamp: new Date()
            });
            
            closeModal();
            showNotification(`${type.charAt(0).toUpperCase() + type.slice(1)} updated successfully!`, 'success');
            loadDataFromBackend();
        } catch (error) {
            console.error('Error:', error);
            showNotification(`Error: ${error.message}`, 'error');
        }
        return;
    }
    
    try {
        // Call backend to register user
        const response = await fetch(`${API_BASE}/api/auth/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: newRecord.email,
                name: newRecord.name,
                password: 'TempPassword123!', // Default password
                role: type,
                requested_role: type,
                auto_approve: true,
                approved_by: adminData.currentUser ? adminData.currentUser.id : null
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to create user');
        }
        
        const result = await response.json();
        
        // Add to local data
        const typeNames = { 'student': 'Student', 'staff': 'Staff member', 'admin': 'Admin' };
        adminData.activityLog.unshift({
            action: `New ${typeNames[type].toLowerCase()} added: ${newRecord.name}`,
            timestamp: new Date()
        });
        
        renderTables();
        updateDashboard();
        loadAuditLogs();
        closeModal();
        showNotification(`${typeNames[type]} added successfully!`, 'success');
        
        // Reload data from backend
        loadDataFromBackend();
        
    } catch (error) {
        console.error('Error:', error);
        showNotification(`Error: ${error.message}`, 'error');
    }
}

// Handle approval table actions
function handleApprovalAction(e) {
    const approveBtn = e.target.closest('.btn-approve');
    if (!approveBtn) return;
    
    const userId = approveBtn.getAttribute('data-user-id');
    const roleSelect = document.querySelector(`.role-select[data-role-for="${userId}"]`);
    const role = roleSelect ? roleSelect.value : 'student';
    
    approveUser(userId, role);
}

// Approve a pending user
async function approveUser(userId, role) {
    try {
        const response = await fetch(`${API_BASE}/api/users/${userId}/approve`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${adminData.authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                role: role,
                actor_id: adminData.currentUser ? adminData.currentUser.id : null
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to approve user');
        }
        
        adminData.activityLog.unshift({
            action: `User approved (ID ${userId}) as ${role}`,
            timestamp: new Date()
        });
        
        showNotification('User approved successfully!', 'success');
        loadDataFromBackend();
    } catch (error) {
        console.error('Approval error:', error);
        showNotification(`Error: ${error.message}`, 'error');
    }
}


function getRecordList(type) {
    if (type === 'student') return adminData.students;
    if (type === 'staff') return adminData.staff;
    if (type === 'admin') return adminData.admins;
    return [];
}


async function loadAuditLogs() {
    const tbody = document.getElementById('auditLogTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr class="empty-row"><td colspan="4" class="empty-state">Loading audit logs...</td></tr>';

    try {
        const response = await fetch(`${API_BASE}/api/audit?limit=100`, {
            headers: {
                'Authorization': `Bearer ${adminData.authToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to load audit logs');
        }

        const logs = await response.json();
        if (!logs || logs.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="4" class="empty-state">No audit logs found</td></tr>';
            return;
        }

        tbody.innerHTML = logs.map(log => {
            const actor = log.actor_name || log.actor_email || 'System';
            const target = log.target || '?';
            const time = log.created_at ? new Date(log.created_at).toLocaleString() : 'N/A';
            return `
                <tr>
                    <td>${actor}</td>
                    <td>${log.action || ''}</td>
                    <td>${target}</td>
                    <td>${time}</td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading audit logs:', error);
        tbody.innerHTML = '<tr class="empty-row"><td colspan="4" class="empty-state">Failed to load audit logs</td></tr>';
        showNotification('Failed to load audit logs', 'error');
    }
}

async function changePassword() {
    const currentPassword = document.getElementById('currentPassword')?.value || '';
    const newPassword = document.getElementById('newPassword')?.value || '';
    const confirmPassword = document.getElementById('confirmPassword')?.value || '';

    if (!currentPassword || !newPassword || !confirmPassword) {
        showNotification('Please fill in all password fields', 'error');
        return;
    }

    if (newPassword.length < 6) {
        showNotification('New password must be at least 6 characters', 'error');
        return;
    }

    if (newPassword !== confirmPassword) {
        showNotification('New passwords do not match', 'error');
        return;
    }

    const userId = adminData.currentUser ? adminData.currentUser.id : null;
    if (!userId) {
        showNotification('No admin user found', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/users/${userId}/password`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${adminData.authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                current_password: currentPassword,
                new_password: newPassword,
                actor_id: userId
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to update password');
        }

        document.getElementById('currentPassword').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';
        showNotification('Password updated successfully', 'success');
    } catch (error) {
        console.error('Password update error:', error);
        showNotification(`Error: ${error.message}`, 'error');
    }
}


function downloadBackup() {
    window.location.href = `${API_BASE}/api/backup/download`;
}

async function restoreBackup() {
    const fileInput = document.getElementById('restoreBackupFile');
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        showNotification('Please choose a backup file (.db)', 'error');
        return;
    }

    if (!confirm('Restoring will replace your current database. Continue?')) {
        return;
    }

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    try {
        const response = await fetch(`${API_BASE}/api/backup/restore`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to restore backup');
        }

        showNotification('Backup restored. Please restart the server.', 'success');
        fileInput.value = '';
    } catch (error) {
        console.error('Restore error:', error);
        showNotification(`Error: ${error.message}`, 'error');
    }
}

// View record
function viewRecord(type, id) {
    const records = getRecordList(type);
    const record = records.find(r => r.id === id);
    
    if (record) {
        console.log('Viewing record:', record);
        showNotification(`Viewing ${type}: ${record.name}`, 'info');
        // In a real app, this would open a detailed view modal
    }
}

// Edit record
function editRecord(type, id) {
    if (!['student', 'staff'].includes(type)) {
        showNotification('Edit is only available for students and staff', 'info');
        return;
    }

    const records = getRecordList(type);
    const record = records.find(r => r.id === id);

    if (!record) {
        showNotification('Record not found', 'error');
        return;
    }

    openEditModal(type, record);
}

// Delete record
async function deleteRecord(type, id) {
    if (confirm('Are you sure you want to delete this record?')) {
        try {
            const response = await fetch(`${API_BASE}/api/users/${id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${adminData.authToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error('Failed to delete user');
            }
            
            // Remove from local data
            const records = getRecordList(type);
            const index = records.findIndex(r => r.id === id);
            
            if (index > -1) {
                const deleted = records.splice(index, 1)[0];
                adminData.activityLog.unshift({
                    action: `${type.charAt(0).toUpperCase() + type.slice(1)} deleted: ${deleted.name}`,
                    timestamp: new Date()
                });
                renderTables();
                updateDashboard();
                showNotification('Record deleted successfully!', 'success');
                
                // Reload data from backend
                loadDataFromBackend();
            }
        } catch (error) {
            console.error('Error:', error);
            showNotification(`Error: ${error.message}`, 'error');
        }
    }
}

// Show notification
function showNotification(message, type = 'info') {
    const toast = document.getElementById('notificationToast');
    toast.textContent = message;
    toast.className = `notification-toast ${type} show`;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
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

// Toggle menu on mobile
function toggleMenu() {
    const nav = document.querySelector('.sidebar-nav');
    nav.classList.toggle('open');
}

// Close menu when a link is clicked on mobile
document.addEventListener('click', function(event) {
    const sidebar = document.querySelector('.sidebar');
    const toggleBtn = document.getElementById('menuToggle');
    
    if (!sidebar.contains(event.target) && !toggleBtn.contains(event.target)) {
        const nav = document.querySelector('.sidebar-nav');
        nav.classList.remove('open');
    }
});

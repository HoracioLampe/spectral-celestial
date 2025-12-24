const API_USERS = '/api/users';
const API_COURSES = '/api/courses';
let isEditingUser = false;
let isEditingCourse = false;

// --- Elementos DOM (Usuarios) ---
const userTableBody = document.getElementById('userTableBody');
const userModal = document.getElementById('userModal');
const userForm = document.getElementById('userForm');
const userModalTitle = document.getElementById('modalTitle');

// --- Elementos DOM (Cursos) ---
const courseTableBody = document.getElementById('coursesTableBody');
const courseModal = document.getElementById('courseModal');
const courseForm = document.getElementById('courseForm');
const courseModalTitle = document.getElementById('courseModalTitle');

document.addEventListener('DOMContentLoaded', () => {
    console.log("🚀 Aplicación iniciada. Cargando datos...");
    fetchUsers();
    fetchCourses();
});

// ==========================================
// --- GESTIÓN DE USUARIOS ---
// ==========================================

async function fetchUsers() {
    if (!userTableBody) return console.error("❌ Error: No se encontró userTableBody");

    try {
        const res = await fetch(API_USERS);
        if (!res.ok) throw new Error('Error en respuesta API');
        const users = await res.json();
        renderUsers(users);
    } catch (error) {
        console.error('❌ Error cargando usuarios:', error);
        userTableBody.innerHTML = '<tr><td colspan="7" style="color: #ff6b6b; text-align: center;">Error cargando datos. Ver consola.</td></tr>';
    }
}

function renderUsers(users) {
    userTableBody.innerHTML = '';
    if (!Array.isArray(users) || users.length === 0) {
        userTableBody.innerHTML = '<tr><td colspan="7" style="text-align:center; opacity: 0.7;">No hay usuarios registrados</td></tr>';
        return;
    }

    users.forEach(user => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>#${user.id}</td>
            <td><strong>${user.nombre}</strong></td>
            <td>${user.apellido}</td>
            <td>${user.dni}</td>
            <td>${user.edad}</td>
            <td>${user.sexo}</td>
            <td>
                <button class="btn btn-sm btn-edit" onclick='openUserModal(${JSON.stringify(user).replace(/"/g, "&quot;")})'>✏️</button>
                <button class="btn btn-sm btn-delete" onclick="deleteUser(${user.id})">🗑️</button>
            </td>
        `;
        userTableBody.appendChild(tr);
    });
}

// Guardar Usuario
if (userForm) {
    userForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const data = {
            nombre: document.getElementById('nombre').value,
            apellido: document.getElementById('apellido').value,
            dni: document.getElementById('dni').value,
            edad: document.getElementById('edad').value,
            sexo: document.getElementById('sexo').value
        };

        const id = document.getElementById('userId').value;
        const method = isEditingUser ? 'PUT' : 'POST';
        const url = isEditingUser ? `${API_USERS}/${id}` : API_USERS;

        try {
            const res = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (res.ok) {
                closeUserModal();
                fetchUsers();
            } else {
                const err = await res.json();
                alert('Error: ' + (err.error || 'Desconocido'));
            }
        } catch (error) {
            console.error(error);
            alert('Error de red al guardar usuario');
        }
    });
}

// Borrar Usuario
window.deleteUser = async function (id) {
    if (!confirm('¿Eliminar usuario?')) return;
    try {
        await fetch(`${API_USERS}/${id}`, { method: 'DELETE' });
        fetchUsers();
    } catch (error) {
        console.error("Error borrando:", error);
    }
};

// Modal Usuario
window.openModal = function () { // Llamado desde HTML (+ Nuevo Usuario)
    openUserModal();
};

window.openUserModal = function (user = null) {
    userModal.classList.add('active');
    if (user) {
        isEditingUser = true;
        userModalTitle.textContent = "Editar Usuario";
        document.getElementById('userId').value = user.id;
        document.getElementById('nombre').value = user.nombre;
        document.getElementById('apellido').value = user.apellido;
        document.getElementById('dni').value = user.dni;
        document.getElementById('edad').value = user.edad;
        document.getElementById('sexo').value = user.sexo;
    } else {
        isEditingUser = false;
        userModalTitle.textContent = "Nuevo Usuario";
        userForm.reset();
        document.getElementById('userId').value = '';
    }
};

window.closeModal = function () {
    closeUserModal();
};

function closeUserModal() {
    userModal.classList.remove('active');
}

// Click fuera para cerrar (Usuario)
if (userModal) {
    userModal.addEventListener('click', (e) => {
        if (e.target === userModal) closeUserModal();
    });
}


// ==========================================
// --- GESTIÓN DE CURSOS ---
// ==========================================

async function fetchCourses() {
    if (!courseTableBody) return console.error("❌ Error: No se encontró courseTableBody");

    try {
        const res = await fetch(API_COURSES);
        if (!res.ok) throw new Error('Error en respuesta API Cursos');
        const courses = await res.json();
        renderCourses(courses);
    } catch (error) {
        console.error('❌ Error cargando cursos:', error);
        courseTableBody.innerHTML = '<tr><td colspan="6" style="color: #ff6b6b; text-align: center;">Error cargando cursos.</td></tr>';
    }
}

function renderCourses(courses) {
    courseTableBody.innerHTML = '';
    if (!Array.isArray(courses) || courses.length === 0) {
        courseTableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; opacity: 0.7;">No hay cursos registrados</td></tr>';
        return;
    }

    courses.forEach(c => {
        const row = document.createElement('tr');
        const fecha = c.fecha_inicio ? new Date(c.fecha_inicio).toLocaleDateString() : '-';

        row.innerHTML = `
            <td>#${c.id}</td>
            <td><strong>${c.nombre}</strong></td>
            <td>${c.nivel}</td>
            <td>${fecha}</td>
            <td>${c.duracion_semanas} sem</td>
            <td>
                <button class="btn btn-sm btn-edit" onclick='openCourseModal(${JSON.stringify(c).replace(/"/g, "&quot;")})'>✏️</button>
                <button class="btn btn-sm btn-delete" onclick="deleteCourse(${c.id})">🗑️</button>
            </td>
        `;
        courseTableBody.appendChild(row);
    });
}

// Guardar Curso
if (courseForm) {
    courseForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const data = {
            nombre: document.getElementById('courseNombre').value,
            descripcion: document.getElementById('courseDescripcion').value,
            nivel: document.getElementById('courseNivel').value,
            fecha_inicio: document.getElementById('courseFecha').value,
            duracion_semanas: document.getElementById('courseDuracion').value
        };

        const id = document.getElementById('courseId').value;
        const method = isEditingCourse ? 'PUT' : 'POST';
        const url = isEditingCourse ? `${API_COURSES}/${id}` : API_COURSES;

        try {
            const res = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (res.ok) {
                closeCourseModal();
                fetchCourses();
            } else {
                const err = await res.json();
                alert('Error: ' + (err.error || 'Desconocido'));
            }
        } catch (error) {
            console.error(error);
            alert('Error de red al guardar curso');
        }
    });
}

// Borrar Curso
window.deleteCourse = async function (id) {
    if (!confirm('¿Eliminar curso?')) return;
    try {
        await fetch(`${API_COURSES}/${id}`, { method: 'DELETE' });
        fetchCourses();
    } catch (error) {
        console.error("Error borrando curso:", error);
    }
};

// Modal Curso
window.openCourseModal = function (course = null) {
    courseModal.classList.add('active');
    if (course && course.id) { // Fix: check if it's a course object or event (if called w/o args)
        isEditingCourse = true;
        courseModalTitle.textContent = "Editar Curso";
        document.getElementById('courseId').value = course.id;
        document.getElementById('courseNombre').value = course.nombre;
        document.getElementById('courseDescripcion').value = course.descripcion || '';
        document.getElementById('courseNivel').value = course.nivel;
        if (course.fecha_inicio) document.getElementById('courseFecha').value = course.fecha_inicio.split('T')[0];
        document.getElementById('courseDuracion').value = course.duracion_semanas;
    } else {
        isEditingCourse = false;
        courseModalTitle.textContent = "Nuevo Curso";
        courseForm.reset();
        document.getElementById('courseId').value = '';
    }
};

window.closeCourseModal = function () {
    courseModal.classList.remove('active');
};

// Click fuera para cerrar (Curso)
if (courseModal) {
    courseModal.addEventListener('click', (e) => {
        if (e.target === courseModal) closeCourseModal();
    });
}

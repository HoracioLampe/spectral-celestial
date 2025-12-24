const API_URL = '/api/users';
let isEditing = false;

// Elementos del DOM
const tableBody = document.querySelector('#usersTable tbody');
const modal = document.getElementById('userModal');
const form = document.getElementById('userForm');
const modalTitle = document.getElementById('modalTitle');

// Cargar usuarios al inicio
document.addEventListener('DOMContentLoaded', fetchUsers);

// --- Funciones CRUD ---

async function fetchUsers() {
    try {
        const res = await fetch(API_URL);
        const users = await res.json();
        renderTable(users);
    } catch (error) {
        console.error('Error cargando usuarios:', error);
        tableBody.innerHTML = '<tr><td colspan="7">Error cargando datos</td></tr>';
    }
}

async function saveUser(e) {
    e.preventDefault();

    const userData = {
        nombre: document.getElementById('nombre').value,
        apellido: document.getElementById('apellido').value,
        dni: document.getElementById('dni').value,
        edad: document.getElementById('edad').value,
        sexo: document.getElementById('sexo').value
    };

    const id = document.getElementById('userId').value;
    const method = isEditing ? 'PUT' : 'POST';
    const url = isEditing ? `${API_URL}/${id}` : API_URL;

    try {
        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(userData)
        });

        const data = await res.json();

        if (res.ok) {
            closeModal();
            fetchUsers();
        } else {
            alert('Error: ' + (data.error || 'Error guardando usuario'));
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

async function deleteUser(id) {
    if (!confirm('¿Estás seguro de eliminar este usuario?')) return;

    try {
        await fetch(`${API_URL}/${id}`, { method: 'DELETE' });
        fetchUsers();
    } catch (error) {
        console.error('Error eliminando:', error);
    }
}

// --- Renderizado ---

function renderTable(users) {
    tableBody.innerHTML = '';

    if (users.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center">No hay usuarios registrados</td></tr>';
        return;
    }

    users.forEach(user => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>#${user.id}</td>
            <td>${user.nombre}</td>
            <td>${user.apellido}</td>
            <td>${user.dni}</td>
            <td>${user.edad}</td>
            <td>${user.sexo}</td>
            <td>
                <button class="btn btn-sm btn-edit" onclick="editUser(${JSON.stringify(user).replace(/"/g, '&quot;')})">Editar</button>
                <button class="btn btn-sm btn-delete" onclick="deleteUser(${user.id})">Borrar</button>
            </td>
        `;
        tableBody.appendChild(tr);
    });
}

// --- Manejo del Modal ---

function openModal() {
    isEditing = false;
    modalTitle.textContent = 'Nuevo Usuario';
    form.reset();
    document.getElementById('userId').value = '';
    modal.classList.add('active');
}

window.editUser = function (user) { // Hacer global para onclick
    isEditing = true;
    modalTitle.textContent = 'Editar Usuario';

    document.getElementById('userId').value = user.id;
    document.getElementById('nombre').value = user.nombre;
    document.getElementById('apellido').value = user.apellido;
    document.getElementById('dni').value = user.dni;
    document.getElementById('edad').value = user.edad;
    document.getElementById('sexo').value = user.sexo;

    modal.classList.add('active');
}

function closeModal() {
    modal.classList.remove('active');
}

// Event Listeners
form.addEventListener('submit', saveUser);

// Cerrar al hacer click fuera
modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
});

// ==========================================
// --- LÓGICA DE CURSOS ---
// ==========================================

const API_COURSES = '/api/courses';
let isEditingCourse = false;

// Variables Cursos
const coursesTableBody = document.getElementById('coursesTableBody');
const courseModal = document.getElementById('courseModal');
const courseForm = document.getElementById('courseForm');
const courseModalTitle = document.getElementById('courseModalTitle');

// Cargar cursos al inicio
document.addEventListener('DOMContentLoaded', fetchCourses);

// 1. Fetch Cursos
async function fetchCourses() {
    try {
        const res = await fetch(API_COURSES);
        const courses = await res.json();
        renderCourses(courses);
    } catch (error) {
        console.error('Error fetching courses:', error);
        coursesTableBody.innerHTML = '<tr><td colspan="6" style="color: #ff6b6b; text-align:center;">Error cargando cursos</td></tr>';
    }
}

// 2. Render Cursos
function renderCourses(courses) {
    coursesTableBody.innerHTML = '';
    if (!courses || courses.length === 0) {
        coursesTableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; opacity: 0.7;">No hay cursos registrados</td></tr>';
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
                <button class="btn btn-sm btn-edit" onclick='editCourse(${JSON.stringify(c).replace(/"/g, "&quot;")})'>Editar</button>
                <button class="btn btn-sm btn-delete" onclick="deleteCourse(${c.id})">Borrar</button>
            </td>
        `;
        coursesTableBody.appendChild(row);
    });
}

// 3. Guardar Curso
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
        alert('Error de red');
    }
});

// 4. Borrar Curso
window.deleteCourse = async function (id) {
    if (!confirm('¿Seguro que quieres eliminar este curso?')) return;
    try {
        await fetch(`${API_COURSES}/${id}`, { method: 'DELETE' });
        fetchCourses();
    } catch (error) {
        console.error(error);
    }
};

// 5. Modales Curso
window.openCourseModal = function () {
    isEditingCourse = false;
    courseModalTitle.textContent = "Nuevo Curso";
    courseForm.reset();
    document.getElementById('courseId').value = '';
    courseModal.classList.add('active');
};

window.closeCourseModal = function () {
    courseModal.classList.remove('active');
};

window.editCourse = function (c) {
    isEditingCourse = true;
    courseModalTitle.textContent = "Editar Curso";

    document.getElementById('courseId').value = c.id;
    document.getElementById('courseNombre').value = c.nombre;
    document.getElementById('courseDescripcion').value = c.descripcion || '';
    document.getElementById('courseNivel').value = c.nivel;
    if (c.fecha_inicio) document.getElementById('courseFecha').value = c.fecha_inicio.split('T')[0];
    document.getElementById('courseDuracion').value = c.duracion_semanas;

    courseModal.classList.add('active');
};

// Cerrar modal curso al click afuera
courseModal.addEventListener('click', (e) => {
    if (e.target === courseModal) closeCourseModal();
});



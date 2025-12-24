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

        if (res.ok) {
            closeModal();
            fetchUsers();
        } else {
            alert('Error guardando usuario');
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

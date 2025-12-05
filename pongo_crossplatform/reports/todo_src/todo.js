
const statusClass = {
    'completed': 'status-completed',
    'in-progress': 'status-in-progress',
    'not-started': 'status-not-started',
    'awaiting-approval': 'status-awaiting-approval'
};

function updateTodoTable(data) {
    const tbody = document.querySelector('#todo-table tbody');
    tbody.innerHTML = '';
    if (!data) return;
    data.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${row.id}</td>
            <td>${row.task}</td>
            <td>${row.subtask}</td>
            <td class="${statusClass[row.status] || ''}">${row.status}</td>
            <td>${row.purpose}</td>
            <td>${row.comments || ''}</td>
            <td>${row.start || ''}</td>
            <td>${row.end || ''}</td>
        `;
        tbody.appendChild(tr);
    });
}

function addLiveLog(msg) {
    const log = document.getElementById('live-log');
    const entry = document.createElement('div');
    entry.textContent = new Date().toLocaleTimeString() + ' - ' + msg;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
}

function showApprovalRequest(task, subtask) {
    const panel = document.getElementById('approval-panel');
    panel.innerHTML = `<div>Approval needed for: <b>${task} - ${subtask}</b><br><button class='approval-btn' onclick='approveTask()'>Approve</button></div>`;
}

function approveTask() {
    addLiveLog('Approval granted by user.');
    document.getElementById('approval-panel').innerHTML = '';
}

// WebSocket connection for live updates
let ws;
function connectWebSocket() {
    ws = new WebSocket(`ws://${window.location.hostname}:8765/ws`);
    ws.onmessage = function(event) {
        const data = JSON.parse(event.data);
        if (data.type === 'todo_update') {
            updateTodoTable(data.todos);
        }
        if (data.type === 'approval_request') {
            showApprovalRequest(data.task, data.subtask);
        }
        if (data.type === 'log') {
            addLiveLog(data.message);
        }
    };
    ws.onclose = function() {
        addLiveLog('WebSocket disconnected, retrying...');
        setTimeout(connectWebSocket, 2000);
    };
}
connectWebSocket();
addLiveLog('Live log system initialized.');

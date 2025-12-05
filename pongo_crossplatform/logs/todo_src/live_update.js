// WebSocket-based live update for todo.html
// This is a mockup: in production, run a local websocket server to push updates

let ws;
function connectWebSocket() {
    ws = new WebSocket('ws://localhost:8765'); // Example port
    ws.onmessage = function(event) {
        const data = JSON.parse(event.data);
        if (data.type === 'todo_update') {
            updateTodoTable(data.todos);
            addLiveLog('Todo list updated: ' + new Date().toLocaleTimeString());
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

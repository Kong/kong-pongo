import asyncio
import json
import os
from pathlib import Path
from aiohttp import web, WSMsgType
import markdown

BASE_DIR = Path(__file__).parent.parent.parent
REPORTS_DIR = BASE_DIR / 'reports'
LOGS_DIR = BASE_DIR / 'logs'
TODO_MD = REPORTS_DIR / 'todo_list.md'
TODO_HTML = LOGS_DIR / 'todo.html'
TODO_SRC = LOGS_DIR / 'todo_src'

# In-memory log and approval queue
live_log = []
approval_requests = []

# Helper: parse todo_list.md to JSON rows
def parse_todo_md():
    rows = []
    if not TODO_MD.exists():
        return rows
    with open(TODO_MD) as f:
        lines = f.readlines()
    for line in lines:
        if line.startswith('|') and not line.startswith('|-'):
            parts = [p.strip() for p in line.strip().split('|')[1:-1]]
            if len(parts) >= 7 and parts[0].isdigit():
                rows.append({
                    'id': parts[0],
                    'task': parts[1],
                    'subtask': parts[2],
                    'status': parts[3],
                    'purpose': parts[4],
                    'comments': '',
                    'start': parts[5],
                    'end': parts[6]
                })
    return rows

# WebSocket handler for live updates
async def websocket_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    # Send initial todo data
    await ws.send_json({'type': 'todo_update', 'todos': parse_todo_md()})
    for log in live_log:
        await ws.send_json({'type': 'log', 'message': log})
    for req in approval_requests:
        await ws.send_json({'type': 'approval_request', **req})
    # Listen for client messages (e.g., approvals)
    async for msg in ws:
        if msg.type == WSMsgType.TEXT:
            data = msg.json()
            if data.get('action') == 'approve':
                live_log.append('Approval granted for: ' + data.get('task', ''))
                await ws.send_json({'type': 'log', 'message': 'Approval granted for: ' + data.get('task', '')})
    return ws

# HTTP handler to serve static files
def static_handler_factory(folder):
    async def handler(request):
        rel_path = request.match_info.get('filename')
        file_path = folder / rel_path
        if file_path.exists():
            return web.FileResponse(str(file_path))
        return web.Response(status=404)
    return handler

# HTTP handler for todo.html
async def todo_html_handler(request):
    return web.FileResponse(str(TODO_HTML))

# HTTP handler for root
async def index_handler(request):
    return web.HTTPFound('/todo.html')

# HTTP handler to trigger todo update (simulate file change)
async def trigger_update(request):
    # In real use, watch file system or trigger on edit
    for ws in request.app['websockets']:
        await ws.send_json({'type': 'todo_update', 'todos': parse_todo_md()})
    return web.Response(text='Triggered')

async def on_startup(app):
    app['websockets'] = set()

async def on_shutdown(app):
    for ws in set(app['websockets']):
        await ws.close()

app = web.Application()
app.on_startup.append(on_startup)
app.on_shutdown.append(on_shutdown)

# Static routes
app.router.add_get('/', index_handler)
app.router.add_get('/todo.html', todo_html_handler)
app.router.add_get('/todo_src/{filename}', static_handler_factory(TODO_SRC))
app.router.add_get('/ws', websocket_handler)
app.router.add_get('/trigger_update', trigger_update)

if __name__ == '__main__':
    web.run_app(app, port=8765)

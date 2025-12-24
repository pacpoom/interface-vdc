<?php
// ==========================================
//  CONFIGURATION (ตั้งค่าการเชื่อมต่อฐานข้อมูล)
// ==========================================
$db_config = [
    'host' => '192.168.111.52',
    'port' => 3308,
    'user' => 'root',
    'pass' => 'Anji@12345',
    'dbname' => 'vdc_db'
];

// ==========================================
//  PHP BACKEND LOGIC (API Endpoint สำหรับ AJAX)
// ==========================================
if (isset($_GET['action']) && $_GET['action'] == 'get_stats') {
    header('Content-Type: application/json');
    
    try {
        $dsn = "mysql:host={$db_config['host']};port={$db_config['port']};dbname={$db_config['dbname']};charset=utf8mb4";
        $pdo = new PDO($dsn, $db_config['user'], $db_config['pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);

        // 1. ดึงจำนวนรถที่รอ Sync (Pending Sync)
        $stmt = $pdo->query("SELECT COUNT(*) as count FROM gaoff WHERE api_flg = 0");
        $pendingSync = $stmt->fetch(PDO::FETCH_ASSOC)['count'];

        // 2. ดึงจำนวนรถที่รอรับเข้า (Waiting Receive)
        $stmt = $pdo->query("SELECT COUNT(*) as count FROM gaoff WHERE pdiin_flg = 0");
        $waitingReceive = $stmt->fetch(PDO::FETCH_ASSOC)['count'];

        // 3. ดึงจำนวน Error ในวันนี้
        $stmt = $pdo->query("SELECT COUNT(*) as count FROM api_logs WHERE log_level = 'ERROR' AND DATE(created_at) = CURDATE()");
        $errorToday = $stmt->fetch(PDO::FETCH_ASSOC)['count'];

        // 4. ดึง Logs ล่าสุด 20 รายการ
        $stmt = $pdo->query("SELECT * FROM api_logs ORDER BY id DESC LIMIT 20");
        $logs = $stmt->fetchAll(PDO::FETCH_ASSOC);

        echo json_encode([
            'status' => 'success',
            'data' => [
                'pending_sync' => $pendingSync,
                'waiting_receive' => $waitingReceive,
                'error_today' => $errorToday,
                'logs' => $logs
            ]
        ]);
    } catch (PDOException $e) {
        echo json_encode(['status' => 'error', 'message' => 'Database Connection Failed: ' . $e->getMessage()]);
    }
    exit; // จบการทำงาน PHP เพื่อส่งกลับแค่ JSON
}
?>

<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Vehicle Data Center - API Dashboard</title>
    <!-- Bootstrap 5 CSS -->
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <!-- Font Awesome -->
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <!-- Google Fonts (Sarabun for Thai) -->
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;600&display=swap" rel="stylesheet">
    
    <style>
        body {
            font-family: 'Sarabun', sans-serif;
            background-color: #f4f6f9;
            color: #333;
        }
        .navbar {
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .navbar-brand {
            font-weight: 600;
            letter-spacing: 0.5px;
        }
        .card-stat {
            border: none;
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.05);
            transition: transform 0.2s;
            height: 100%;
        }
        .card-stat:hover {
            transform: translateY(-5px);
        }
        .icon-box {
            width: 50px;
            height: 50px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 10px;
            font-size: 1.5rem;
            margin-right: 15px;
        }
        .bg-gradient-primary { background: linear-gradient(45deg, #4e73df, #224abe); color: white; }
        .bg-gradient-success { background: linear-gradient(45deg, #1cc88a, #13855c); color: white; }
        .bg-gradient-warning { background: linear-gradient(45deg, #f6c23e, #dda20a); color: white; }
        .bg-gradient-danger { background: linear-gradient(45deg, #e74a3b, #be2617); color: white; }
        
        .log-table th {
            background-color: #e9ecef;
            font-weight: 600;
        }
        .log-level-badge {
            font-size: 0.8rem;
            padding: 5px 8px;
            border-radius: 6px;
        }
        .status-dot {
            height: 12px;
            width: 12px;
            background-color: #bbb;
            border-radius: 50%;
            display: inline-block;
            margin-right: 5px;
        }
        .status-online { background-color: #1cc88a; box-shadow: 0 0 8px #1cc88a; }
        .status-offline { background-color: #e74a3b; }
        
        /* Animation for loading */
        @keyframes pulse {
            0% { opacity: 0.5; }
            50% { opacity: 1; }
            100% { opacity: 0.5; }
        }
        .loading { animation: pulse 1.5s infinite; }
    </style>
</head>
<body>

    <!-- Navbar -->
    <nav class="navbar navbar-dark navbar-expand-lg">
        <div class="container-fluid px-4">
            <a class="navbar-brand" href="#">
                <i class="fas fa-server me-2"></i> Vehicle Data Center Monitor
            </a>
            <div class="d-flex align-items-center text-white">
                <span class="me-3" id="server-status-container">
                    API Server (Port 4000): <span id="server-status-dot" class="status-dot"></span> <span id="server-status-text">Checking...</span>
                </span>
                <button class="btn btn-sm btn-outline-light" onclick="fetchData()">
                    <i class="fas fa-sync-alt"></i> Refresh
                </button>
            </div>
        </div>
    </nav>

    <div class="container-fluid px-4 py-4">
        
        <!-- Status Cards -->
        <div class="row g-4 mb-4">
            <!-- Card 1: Pending Sync -->
            <div class="col-xl-3 col-md-6">
                <div class="card card-stat">
                    <div class="card-body d-flex align-items-center">
                        <div class="icon-box bg-gradient-warning">
                            <i class="fas fa-exchange-alt"></i>
                        </div>
                        <div>
                            <div class="text-muted small text-uppercase fw-bold">รอ Sync (Pending)</div>
                            <div class="h3 mb-0 fw-bold text-gray-800" id="stat-pending-sync">-</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Card 2: Waiting Receive -->
            <div class="col-xl-3 col-md-6">
                <div class="card card-stat">
                    <div class="card-body d-flex align-items-center">
                        <div class="icon-box bg-gradient-primary">
                            <i class="fas fa-truck-loading"></i>
                        </div>
                        <div>
                            <div class="text-muted small text-uppercase fw-bold">รอรับเข้า (No PDI)</div>
                            <div class="h3 mb-0 fw-bold text-gray-800" id="stat-waiting-receive">-</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Card 3: Errors Today -->
            <div class="col-xl-3 col-md-6">
                <div class="card card-stat">
                    <div class="card-body d-flex align-items-center">
                        <div class="icon-box bg-gradient-danger">
                            <i class="fas fa-exclamation-triangle"></i>
                        </div>
                        <div>
                            <div class="text-muted small text-uppercase fw-bold">Errors วันนี้</div>
                            <div class="h3 mb-0 fw-bold text-danger" id="stat-error-today">-</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Card 4: System Time -->
            <div class="col-xl-3 col-md-6">
                <div class="card card-stat">
                    <div class="card-body d-flex align-items-center">
                        <div class="icon-box bg-gradient-success">
                            <i class="fas fa-clock"></i>
                        </div>
                        <div>
                            <div class="text-muted small text-uppercase fw-bold">เวลาล่าสุด</div>
                            <div class="h5 mb-0 fw-bold text-gray-800" id="current-time">-</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Main Content Row -->
        <div class="row">
            <!-- Log Table -->
            <div class="col-12">
                <div class="card shadow mb-4">
                    <div class="card-header py-3 d-flex justify-content-between align-items-center bg-white">
                        <h6 class="m-0 fw-bold text-primary"><i class="fas fa-list-alt me-1"></i> Live API Logs (ล่าสุด 20 รายการ)</h6>
                        <span class="badge bg-secondary" id="last-update">Last update: -</span>
                    </div>
                    <div class="card-body p-0">
                        <div class="table-responsive">
                            <table class="table table-hover table-striped mb-0 align-middle log-table">
                                <thead>
                                    <tr>
                                        <th style="width: 5%">ID</th>
                                        <th style="width: 10%">Level</th>
                                        <th style="width: 15%">Source</th>
                                        <th style="width: 30%">Message</th>
                                        <th style="width: 25%">Details</th>
                                        <th style="width: 15%">Time</th>
                                    </tr>
                                </thead>
                                <tbody id="log-table-body">
                                    <!-- Rows will be populated by JS -->
                                    <tr><td colspan="6" class="text-center py-4">Loading data...</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Details Modal -->
    <div class="modal fade" id="detailModal" tabindex="-1">
        <div class="modal-dialog modal-lg">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">Log Details</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                    <pre id="modal-content" class="bg-light p-3 rounded border" style="white-space: pre-wrap;"></pre>
                </div>
            </div>
        </div>
    </div>

    <!-- JavaScript Bundle with Popper -->
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    
    <script>
        // --- Configuration ---
        const NODE_API_URL = 'http://localhost:4000'; // URL ของ Node.js Server
        
        // --- Functions ---

        // 1. Update Clock
        function updateClock() {
            const now = new Date();
            document.getElementById('current-time').innerText = now.toLocaleTimeString('th-TH');
        }

        // 2. Check Node.js Server Status
        async function checkServerStatus() {
            const dot = document.getElementById('server-status-dot');
            const text = document.getElementById('server-status-text');
            
            try {
                // พยายาม fetch ไปที่ root หรือ endpoint ง่ายๆ (ถ้าได้ 404/401 ก็ถือว่า Server Up)
                // ใช้ mode: 'no-cors' เพื่อหลีกเลี่ยง CORS error ในการเช็คเบื้องต้น
                await fetch(NODE_API_URL, { mode: 'no-cors' }); 
                
                // ถ้า fetch สำเร็จ (แม้จะ 404) แปลว่าเชื่อมต่อได้
                dot.className = 'status-dot status-online';
                text.innerText = 'Online';
                text.className = 'text-success fw-bold';
            } catch (error) {
                // ถ้า fetch ไม่ได้ (Network Error) แปลว่า Server Down
                dot.className = 'status-dot status-offline';
                text.innerText = 'Offline / Unreachable';
                text.className = 'text-danger fw-bold';
            }
        }

        // 3. Fetch Data from PHP Backend
        async function fetchData() {
            try {
                const response = await fetch('dashboard.php?action=get_stats');
                const result = await response.json();

                if (result.status === 'success') {
                    updateDashboard(result.data);
                } else {
                    console.error('API Error:', result.message);
                }
            } catch (error) {
                console.error('Fetch Error:', error);
            }
            
            // Update timestamp
            const now = new Date();
            document.getElementById('last-update').innerText = 'Last update: ' + now.toLocaleTimeString('th-TH');
        }

        // 4. Update UI Elements
        function updateDashboard(data) {
            // Update Stats Cards
            document.getElementById('stat-pending-sync').innerText = data.pending_sync;
            document.getElementById('stat-waiting-receive').innerText = data.waiting_receive;
            document.getElementById('stat-error-today').innerText = data.error_today;

            // Update Log Table
            const tbody = document.getElementById('log-table-body');
            tbody.innerHTML = '';

            if (data.logs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4">No logs found</td></tr>';
                return;
            }

            data.logs.forEach(log => {
                const row = document.createElement('tr');
                
                // Badge Color Logic
                let badgeClass = 'bg-secondary';
                if (log.log_level === 'INFO') badgeClass = 'bg-info text-dark';
                else if (log.log_level === 'WARN') badgeClass = 'bg-warning text-dark';
                else if (log.log_level === 'ERROR') badgeClass = 'bg-danger';

                // Format JSON/Details for display
                let detailsPreview = log.details ? (log.details.length > 50 ? log.details.substring(0, 50) + '...' : log.details) : '-';
                let detailsFull = log.details || '';
                
                // Escape HTML to prevent XSS
                const escapeHtml = (text) => {
                    if (!text) return '';
                    return text.replace(/&/g, "&amp;")
                               .replace(/</g, "&lt;")
                               .replace(/>/g, "&gt;")
                               .replace(/"/g, "&quot;")
                               .replace(/'/g, "&#039;");
                };

                row.innerHTML = `
                    <td>${log.id}</td>
                    <td><span class="badge log-level-badge ${badgeClass}">${log.log_level}</span></td>
                    <td><small class="fw-bold text-primary">${escapeHtml(log.source)}</small></td>
                    <td>${escapeHtml(log.message)}</td>
                    <td>
                        <small class="text-muted" style="cursor:pointer;" onclick="showDetails(this)" data-full="${escapeHtml(detailsFull)}">
                            ${escapeHtml(detailsPreview)} <i class="fas fa-search-plus ms-1"></i>
                        </small>
                    </td>
                    <td><small class="text-muted">${log.created_at}</small></td>
                `;
                tbody.appendChild(row);
            });
        }

        // 5. Show Details Modal
        window.showDetails = function(element) {
            const fullText = element.getAttribute('data-full');
            
            // Try formatting JSON if possible
            let content = fullText;
            try {
                const jsonObj = JSON.parse(fullText);
                content = JSON.stringify(jsonObj, null, 2);
            } catch (e) {
                // Not JSON, use original text
            }
            
            document.getElementById('modal-content').innerText = content;
            const modal = new bootstrap.Modal(document.getElementById('detailModal'));
            modal.show();
        }

        // --- Initialization ---
        document.addEventListener('DOMContentLoaded', () => {
            updateClock();
            setInterval(updateClock, 1000); // Clock tick

            checkServerStatus();
            fetchData(); // Initial load

            // Auto-refresh data every 5 seconds
            setInterval(() => {
                fetchData();
                checkServerStatus(); // Check server status too
            }, 5000);
        });

    </script>
</body>
</html>
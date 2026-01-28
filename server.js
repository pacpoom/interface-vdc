const express = require('express');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4001;

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

app.use(express.json());

// --- เพิ่ม: Error Handler สำหรับ JSON Syntax Error ---
// ช่วยแจ้งเตือนกรณีส่ง JSON ผิดรูปแบบ แทนที่จะปล่อยให้ Server แจ้ง Error ยาวๆ
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        const errorResponse = { 
            error: 'Invalid JSON format', 
            message: 'รูปแบบ JSON ไม่ถูกต้อง กรุณาตรวจสอบเครื่องหมาย " หรือ , ใน Body',
            details: err.message 
        };
        console.error('❌ JSON Parse Error:', err.message);
        // Log Error Response
        saveLog('ERROR', 'middleware_json', 'JSON Parse Error', errorResponse, 'SYSTEM');
        return res.status(400).json(errorResponse);
    }
    next();
});
// ------------------------------------------------

const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
};

let pool; // Connection Pool

async function initializeDatabase() {
    try {
        console.log(`Attempting to connect to MySQL at ${dbConfig.host}:${dbConfig.port}...`);
        
        pool = mysql.createPool(dbConfig);
        
        const [rows] = await pool.query('SELECT 1 + 1 AS solution');

        if (rows[0].solution === 2) {
            console.log('✅ Database connection successful!');
            console.log(`Database: ${dbConfig.database}`);
        } else {
            console.error('❌ Connection established but test query failed.');
        }

        // --- Create Log Table if not exists ---
        const createLogTableSql = `
            CREATE TABLE IF NOT EXISTS api_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                log_level VARCHAR(10) NOT NULL COMMENT 'INFO, ERROR, WARN',
                source VARCHAR(50) COMMENT 'Function or Module name',
                message TEXT COMMENT 'Short description',
                details LONGTEXT COMMENT 'Full Error stack or JSON payload',
                operator VARCHAR(100) COMMENT 'Username or SYSTEM',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
        `;
        await pool.query(createLogTableSql);
        console.log('✅ Log table (api_logs) is ready.');

    } catch (error) {
        console.error('❌ FATAL ERROR: Database connection failed!');
        console.error(`Error details: ${error.message}`);
        console.error('---');
        console.error('Possible Causes:');
        console.error('1. MySQL Server is not running on 192.168.111.52:3308.');
        console.error('2. Firewall is blocking the connection.');
        console.error('3. User/Password in .env file is incorrect.');
        console.error('4. DB_NAME is incorrect.');
        process.exit(1); 
    }
}

// --- Helper Function: Save Log to Database ---
async function saveLog(level, source, message, details, operator = 'SYSTEM') {
    try {
        // Ensure details is a string (JSON stringify if it's an object)
        const detailStr = typeof details === 'object' ? JSON.stringify(details) : String(details || '');
        
        const sql = 'INSERT INTO api_logs (log_level, source, message, details, operator) VALUES (?, ?, ?, ?, ?)';
        await pool.query(sql, [level, source, message, detailStr, operator]);
    } catch (err) {
        // Fallback to console if DB logging fails to avoid infinite loops
        console.error('❌ Failed to save log to DB:', err.message);
    }
}

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        const errorResponse = { 
            error: 'Access Denied', 
            message: 'Authorization header format must be "Bearer <token>".' 
        };
        // Log auth failure (Optional: might be too noisy)
        // saveLog('WARN', 'middleware_auth', 'Missing/Invalid Header', errorResponse, 'UNKNOWN');
        return res.status(401).json(errorResponse);
    }

    const token = authHeader.split(' ')[1];

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            const errorResponse = { 
                error: 'Forbidden', 
                message: 'Invalid, expired, or tampered token.' 
            };
            return res.status(403).json(errorResponse);
        }
        req.user = user; 
        next(); 
    });
};

app.post('/api/login', async (req, res) => {
    // แก้ไข: รับค่า username และ password จาก Headers แทน Body
    // Express จะแปลง key ใน headers เป็นตัวพิมพ์เล็กทั้งหมดโดยอัตโนมัติ
    const username = req.headers['username'];
    const password = req.headers['password'];

    if (!username || !password) {
        const errorResponse = { error: 'Authentication failed', message: 'Username and password are required in Headers.' };
        await saveLog('WARN', 'api_login', 'Login Failed: Missing credentials in Headers', errorResponse, 'UNKNOWN');
        return res.status(400).json(errorResponse);
    }

    try {
        const [users] = await pool.query(
            'SELECT id, username, password_hash, api_key_status FROM api_user WHERE username = ?',
            [username]
        );

        const user = users[0];
        if (!user) {
            const errorResponse = { error: 'Authentication failed', message: 'Invalid username' };
            await saveLog('WARN', 'api_login', 'Login Failed: Invalid Username', errorResponse, 'UNKNOWN');
            return res.status(401).json(errorResponse);
        }
        
        const isPasswordValid = await bcrypt.compare(password, user.password_hash);

        if (!isPasswordValid) {
            const errorResponse = { error: 'Authentication failed', message: 'Invalid username or password.' };
            await saveLog('WARN', 'api_login', 'Login Failed: Invalid Password', errorResponse, username);
            return res.status(401).json(errorResponse);
        }
        
        if (user.api_key_status !== 1) {
            const errorResponse = { error: 'Access Denied', message: 'API key is inactive.' };
            await saveLog('WARN', 'api_login', 'Login Failed: Inactive API Key', errorResponse, username);
            return res.status(403).json(errorResponse);
        }

        const userPayload = { 
            id: user.id, 
            username: user.username,
            role: user.api_key_status === 1 ? 'active_api' : 'inactive_api' 
        };

        const accessToken = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '1h' });

        const successResponse = {
            message: `Login successful for user: ${user.username}. Use this token for secured endpoints.`,
            accessToken: accessToken,
            user: userPayload
        };

        // Log successful login with RESPONSE details
        await saveLog('INFO', 'api_login', `User ${username} logged in`, successResponse, username);

        return res.status(200).json(successResponse);
        
    } catch (error) {
        console.error('Error during login process:', error.message);
        const errorResponse = { error: 'Internal Server Error', message: error.message };
        await saveLog('ERROR', 'api_login', 'Internal Server Error', errorResponse, 'SYSTEM');
        res.status(500).json(errorResponse);
    }
});

app.get('/api/vehicle_no/:vin_number', authenticateToken, async (req, res) => {

    console.log('Authenticated User:', req.user.username, 'Role:', req.user.role); 

    const vinNumber = req.params.vin_number; 

    if (!vinNumber) {
        const errorResponse = { error: 'VIN number is required in the path.' };
        await saveLog('WARN', 'api_get_vehicle', 'Missing VIN in path', errorResponse, req.user.username);
        return res.status(400).json(errorResponse);
    }
    
    try {
        // Log the query attempt (Request Log)
        await saveLog('INFO', 'api_get_vehicle', 'Query VIN Attempt', `Requesting VIN: ${vinNumber}`, req.user.username);

        const [rows] = await pool.query(
            'SELECT * FROM gaoff WHERE vin_number = ?',
            [vinNumber]
        );

        if (rows.length === 0) {
            const notFoundResponse = {
                status: 0,
                vin_number: vinNumber,
                message: 'No Data'
            };
            // Log Response (Not Found)
            await saveLog('INFO', 'api_get_vehicle', 'VIN Not Found', notFoundResponse, req.user.username);
            return res.status(404).json(notFoundResponse);
        }
        
        const vehicleData = rows[0];
        let successResponse;

        if (vehicleData.pdiin_flg === 1) {
            successResponse = { 
                status: 2,
                vehicle_number: vehicleData.vin_number,
                vehicle_code: vehicleData.vc_code,
                engine_code: vehicleData.engine_code,
                ga_off_time: vehicleData.ga_off_time,
                pdiin_flg: vehicleData.pdiin_flg,
                message: 'Received'
            };
        } else {
            successResponse = {
                status: 1,
                vehicle_number: vehicleData.vin_number,
                vehicle_code: vehicleData.vc_code,
                engine_code: vehicleData.engine_code,
                ga_off_time: vehicleData.ga_off_time,
                pdiin_flg: vehicleData.pdiin_flg,
                message: 'Waiting Receive'
            };
        }

        // Log Response (Success)
        await saveLog('INFO', 'api_get_vehicle', 'VIN Query Success', successResponse, req.user.username);
        
        return res.status(200).json(successResponse);
        

    } catch (error) {
        console.error('Error fetching vehicle number:', error.message);
        const errorResponse = {
            error: 'Internal Server Error while querying the database.',
            details: error.message
        };
        await saveLog('ERROR', 'api_get_vehicle', 'Error fetching vehicle', errorResponse, req.user.username);
        res.status(500).json(errorResponse);
    }
});

app.post('/api/receiving', authenticateToken, async (req, res) => {
    
    console.log(`Authenticated User ${req.user.username} attempting to update pdiin_flg.`); 

    const { vin_number, pdiin_flg, date_time } = req.body; 

    // Validate Input
    if (!vin_number || pdiin_flg === undefined || !date_time) {
        const errorResponse = { 
            error: 'Invalid Input', 
            message: 'vin_number (string), pdiin_flg (number), and date_time (string) are required in the request body.' 
        };
        await saveLog('WARN', 'api_receiving', 'Invalid Input', errorResponse, req.user.username);
        return res.status(400).json(errorResponse);
    }

    const flagValue = parseInt(pdiin_flg, 10);
    if (flagValue !== 0 && flagValue !== 1) {
         const errorResponse = { 
            error: 'Invalid Flag Value', 
            message: 'pdiin_flg must be either 0 or 1.' 
        };
         await saveLog('WARN', 'api_receiving', 'Invalid Flag Value', errorResponse, req.user.username);
         return res.status(400).json(errorResponse);
    }

    // Format date_time
    const formattedDate = date_time.replace(/\//g, '-');

    try {
        // Check current status
        const [checkRows] = await pool.query(
            'SELECT id, pdiin_flg, vc_code FROM gaoff WHERE vin_number = ?',
            [vin_number]
        );
        
        if (checkRows.length === 0) {
             const notFoundResponse = {
                status: 0,
                message: `Failed to update. VIN number '${vin_number}' not found in gaoff table.`,
            };
             await saveLog('WARN', 'api_receiving', 'VIN Not Found', notFoundResponse, req.user.username);
             return res.status(404).json(notFoundResponse);
        }
        
        const currentPdiinFlg = checkRows[0].pdiin_flg;

        if (currentPdiinFlg === 1) {
             const conflictResponse = {
                status: 2,
                message: `Vehicle with VIN '${vin_number}' has already been received (pdiin_flg is already 1).`,
            };
             await saveLog('INFO', 'api_receiving', 'Already Received', conflictResponse, req.user.username);
             return res.status(409).json(conflictResponse);
        }
        
        // 1. Update gaoff status
        const [result] = await pool.query(
            'UPDATE gaoff SET pdiin_flg = ?, pdiin_time = ? WHERE vin_number = ?',
            [flagValue, formattedDate, vin_number]
        );

        if (result.affectedRows === 0) {
            const errorResponse = {
                status: 0,
                message: `Update failed unexpectedly for VIN: ${vin_number}.`,
            };
            await saveLog('ERROR', 'api_receiving', 'Update Failed Unexpectedly', errorResponse, req.user.username);
            return res.status(500).json(errorResponse);
        }

        // ==================================================================================
        // NEW SECTION: Insert into gcms_interface_dcin
        // ==================================================================================
        if (flagValue === 1) { // ทำเฉพาะตอนรับเข้า (pdiin_flg = 1)
            try {
                // 2. Query Data ตาม Logic SQL ที่ให้มา
                // Note: เพิ่ม T1.id (gaoff_id) เข้ามาด้วยเพราะจำเป็นต้องใช้ในการ Insert
                const sqlGetDetails = `
                    SELECT 
                        T1.id AS gaoff_id,
                        T1.vin_number,
                        T1.vc_code,
                        IFNULL(T3.topic, '') AS Model_no,
                        IFNULL(T3.category_id, '') AS model_id,
                        IFNULL(T4.topic, '') AS Color,
                        IFNULL(T4.category_id, '') AS color_id
                    FROM gaoff AS T1
                    LEFT JOIN gcms_vehicle_code AS T2 
                        ON T1.vc_code = T2.vehicle_code
                    LEFT JOIN gcms_category AS T3 
                        ON T2.model = T3.category_id AND T3.type = 'vehicle_model'
                    LEFT JOIN gcms_category AS T4 
                        ON T2.color = T4.category_id AND T4.type = 'vehicle_color'
                    WHERE T1.vin_number = ?
                `;

                const [labelDetails] = await pool.query(sqlGetDetails, [vin_number]);

                if (labelDetails.length > 0) {
                    const data = labelDetails[0];

                    // 3. Insert into gcms_label
                    // Note: location_code ใส่เป็นค่าว่าง, print_flg ใส่เป็น 0 (ยังไม่ปริ้น)
                    const sqlInsertLabel = `
                        INSERT INTO gcms_label 
                        (vin_number, vc_code, model, color, location_code, print_flg, received_date) 
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `;

                    await pool.query(sqlInsertLabel, [
                        data.vin_number,
                        data.vc_code,
                        data.Model_no,
                        data.Color,
                        'TRANSIT',  // location_code (default empty)
                        0,   // print_flg (default 0)
                        formattedDate
                    ]);

                    console.log(`Label data inserted for VIN: ${vin_number}`);
                    await saveLog('INFO', 'api_receiving', 'Inserted into gcms_label', { vin: vin_number }, req.user.username);
                } else {
                    console.warn(`Label data extraction failed for VIN: ${vin_number} (No data returned from JOINs)`);
                    await saveLog('WARN', 'api_receiving', 'Label Data Not Found', { vin: vin_number }, req.user.username);
                }

                const [dcinDetails] = await pool.query(sqlGetDetails, [vin_number]);

                if (dcinDetails.length > 0) {
                    const data = dcinDetails[0];

                    // 3. Insert into gcms_interface_dcin
                    const sqlInsertDcin = `
                        INSERT INTO gcms_interface_dcin 
                        (interface_type, dcin_flg, print_flg, gaoff_id, vin_number, vc_code, model, color, location_id, file_name, interface_time) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `;

                    await pool.query(sqlInsertDcin, [
                        'DCIN',             // interface_type
                        0,                  // dcin_flg
                        0,                  // print_flg (0=Waiting Print)
                        data.gaoff_id,      // gaoff_id
                        data.vin_number,    // vin_number
                        data.vc_code,       // vc_code
                        data.model_id,      // model (ใช้ ID ตามตัวอย่างข้อมูล)
                        data.color_id,      // color (ใช้ ID ตามตัวอย่างข้อมูล)
                        'TRANSIT',                 // location_id (Default Empty, หรือใส่ 'TRANSIT' ถ้าต้องการ)
                        '',                 // file_name
                        formattedDate       // interface_time
                    ]);

                    console.log(`DCIN Interface data inserted for VIN: ${vin_number}`);
                    await saveLog('INFO', 'api_receiving', 'Inserted into gcms_interface_dcin', { vin: vin_number }, req.user.username);
                } else {
                    console.warn(`DCIN data extraction failed for VIN: ${vin_number}`);
                    await saveLog('WARN', 'api_receiving', 'DCIN Data Not Found', { vin: vin_number }, req.user.username);
                }

            } catch (insertError) {
                // Log error แต่ไม่ให้กระทบ Flow หลัก
                console.error('Error inserting gcms_interface_dcin:', insertError.message);
                await saveLog('ERROR', 'api_receiving', 'Error inserting gcms_interface_dcin', { error: insertError.message }, req.user.username);
            }
        }
        // ==================================================================================

        const successResponse = {
            status: 1,
            message: `Successfully updated pdiin_flg to ${flagValue} for VIN: ${vin_number}.`,
            currentPdiinFlg: currentPdiinFlg,
            rows_affected: result.affectedRows,
            received_at: formattedDate
        };

        await saveLog('INFO', 'api_receiving', `Updated pdiin_flg to ${flagValue}`, successResponse, req.user.username);

        return res.status(200).json(successResponse);

    } catch (error) {
        console.error('Error updating pdiin_flg:', error.message);
        const errorResponse = {
            error: 'Internal Server Error while updating the database.',
            details: error.message
        };
        await saveLog('ERROR', 'api_receiving', 'Error updating pdiin_flg', errorResponse, req.user.username);
        res.status(500).json(errorResponse);
    }
});

app.post('/api/delivery', authenticateToken, async (req, res) => {
    
    console.log(`Authenticated User ${req.user.username} attempting to update delivery_flg.`); 

    const { vin_number, date_time } = req.body; 

    // 1. Validation
    if (!vin_number || !date_time) {
        const errorResponse = { 
            error: 'Invalid Input', 
            message: 'vin_number and date_time are required in the request body.' 
        };
        await saveLog('WARN', 'api_delivery', 'Invalid Input', errorResponse, req.user.username);
        return res.status(400).json(errorResponse);
    }

    // Format date_time
    const formattedDate = date_time.replace(/\//g, '-');

    try {
        // 2. Check current status
        const [rows] = await pool.query(
            'SELECT delivery_flg, pdiin_flg FROM gaoff WHERE vin_number = ?',
            [vin_number]
        );
        
        // Check if VIN exists
        if (rows.length === 0) {
            const notFoundResponse = {
                status: 0, 
                message: `VIN number '${vin_number}' not found in System.`,
                vin_number: vin_number
            };
            await saveLog('WARN', 'api_delivery', 'VIN Not Found', notFoundResponse, req.user.username);
            return res.status(404).json(notFoundResponse);
        }

        const vehicleData = rows[0];

        // Condition 1: Already Delivered
        if (vehicleData.delivery_flg === 1) {
            const conflictResponse = {
                status: 2, 
                message: `Vehicle with VIN '${vin_number}' is already marked as delivered.`,
                vin_number: vin_number
            };
            await saveLog('INFO', 'api_delivery', 'Already Delivered', conflictResponse, req.user.username);
            return res.status(200).json(conflictResponse);
        }

        // Condition 2: Not Received yet (pdiin_flg = 0)
        if (vehicleData.pdiin_flg === 0) {
            const waitingResponse = {
                status: 3, 
                message: `Vehicle with VIN '${vin_number}' is waiting for receive (pdiin_flg = 0). Cannot set delivery_flg.`,
                vin_number: vin_number
            };
            await saveLog('INFO', 'api_delivery', 'Waiting Receive', waitingResponse, req.user.username);
            return res.status(200).json(waitingResponse);
        }

        // Condition 3: Ready to update (delivery_flg == 0 AND pdiin_flg == 1)
        if (vehicleData.delivery_flg === 0 && vehicleData.pdiin_flg === 1) {
            
            // 3. Update gaoff table
            const [updateResult] = await pool.query(
                'UPDATE gaoff SET delivery_flg = 1, delivery_time = ? WHERE vin_number = ?',
                [formattedDate, vin_number]
            );

            if (updateResult.affectedRows === 1) {
                
                // 4. Update gcms_interface_scot table (แก้ไข: ใช้ pool.query แทน connection.execute)
                try {
                    await pool.query(
                        'UPDATE gcms_interface_scot SET scot_flg = 0 WHERE vin_number = ?',
                        [vin_number]
                    );
                    console.log(`Updated gcms_interface_scot scot_flg=0 for VIN: ${vin_number}`);
                } catch (scotError) {
                    // Log error but generally we might not want to fail the whole request if only the interface update fails
                    // หรือถ้าซีเรียสอาจจะต้องทำ Transaction แต่เบื้องต้น Log ไว้ก่อน
                    console.error('Error updating gcms_interface_scot:', scotError.message);
                    await saveLog('ERROR', 'api_delivery', 'Error updating scot_flg', { error: scotError.message }, req.user.username);
                }

                const successResponse = {
                    status: 1, 
                    message: `Successfully updated delivery_flg to 1 for VIN: ${vin_number}.`,
                    vin_number: vin_number,
                    delivery_at: formattedDate
                };
                
                await saveLog('INFO', 'api_delivery', `Delivery Update Success`, successResponse, req.user.username);

                return res.status(200).json(successResponse);
            } else {
                // กรณี Query รันผ่านแต่ไม่มี Row ถูกอัปเดต (อาจเกิด Race Condition น้อยมาก)
                throw new Error('Update affected 0 rows unexpectedly.');
            }
        }
        
        // Fallback for unexpected logic state
        const logicErrorResponse = {
            error: 'Internal Logic Error',
            message: 'An unexpected state occurred during the delivery flag update process.'
        };
        await saveLog('ERROR', 'api_delivery', 'Logic Error', logicErrorResponse, req.user.username);
        return res.status(500).json(logicErrorResponse);

    } catch (error) {
        console.error('Error updating delivery_flg:', error.message);
        const errorResponse = {
            error: 'Internal Server Error while querying the database.',
            details: error.message
        };
        await saveLog('ERROR', 'api_delivery', 'Error updating delivery_flg', errorResponse, req.user.username);
        res.status(500).json(errorResponse);
    }
});

// Helper function to format date to "YYYY/MM/DD HH:MM:SS" (For Anji Interface)
function formatDateForAnji(date) {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return ''; // Return empty string if invalid date

    const pad = (n) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// SHARED FUNCTION: Handle the sync logic (Used by API and Scheduler)
async function executeGaOffSync(operatorName = 'SYSTEM') {
    const logPrefix = `[GaOff Sync - ${operatorName}]`;
    console.log(`${logPrefix} Process started at ${new Date().toISOString()}`);

    // DB Log: Start
    await saveLog('INFO', 'gaoff_sync', 'Sync process started', { status: 'started' }, operatorName);

    const TARGET_URL = 'https://gvwms.anji-logistics.com/dataway/api';
    const HEADERS = {
        'Content-Type': 'application/json;charset=utf-8',
        'appId': '20260112095337583',
        'apiCode': 'thaiMgInbound'
    };

    try {
        // 1. Query Data
        const sqlSelect = `
            SELECT 
                vin_number AS vinCode, 
                vc_code AS materialCode, 
                engine_code AS enginecode, 
                ga_off_time AS productionDate, 
                pdiin_flg AS flag 
            FROM gaoff 
            WHERE api_flg = 0;
        `;
        
        const [rows] = await pool.query(sqlSelect);

        if (rows.length === 0) {
            console.log(`${logPrefix} No pending records found.`);
            const noDataResult = {
                message: 'No pending records found (api_flg = 0).',
                processed_count: 0
            };
            await saveLog('INFO', 'gaoff_sync', 'No pending records found', noDataResult, operatorName);
            return noDataResult;
        }

        console.log(`${logPrefix} Found ${rows.length} records to sync.`);
        await saveLog('INFO', 'gaoff_sync', `Found ${rows.length} records`, { count: rows.length }, operatorName);

        const results = [];
        const errors = [];

        // 2. Loop & Post
        for (const row of rows) {
            const payload = {
                vinCode: row.vinCode,
                materialCode: row.materialCode,
                engine_code: row.enginecode, 
                productionDate: formatDateForAnji(row.productionDate),
                flag: 0 // Assuming flag is always 0 for this sync
            };

            try {
                const response = await fetch(TARGET_URL, {
                    method: 'POST',
                    headers: HEADERS,
                    body: JSON.stringify(payload)
                });

                const responseData = await response.json();

                if (response.ok && responseData.code === '200') {
                    results.push({ vin: row.vinCode, status: 'success', external_response: responseData });
                } else {
                    console.error(`${logPrefix} Failed to send VIN ${row.vinCode}:`, responseData);
                    // DB Log: Individual Failure
                    await saveLog('ERROR', 'gaoff_sync', `Failed to send VIN ${row.vinCode}`, responseData, operatorName);
                    errors.push({ vin: row.vinCode, status: 'failed', error: responseData });
                }

            } catch (err) {
                console.error(`${logPrefix} Network error sending VIN ${row.vinCode}:`, err.message);
                // DB Log: Network Error
                await saveLog('ERROR', 'gaoff_sync', `Network error VIN ${row.vinCode}`, { message: err.message }, operatorName);
                errors.push({ vin: row.vinCode, status: 'network_error', error: err.message });
            }
        }

        // 3. Update DB
        let updateResult = { affectedRows: 0 };
        const sqlUpdate = `UPDATE gaoff SET api_flg = 1 WHERE api_flg = 0;`;
        const [updRes] = await pool.query(sqlUpdate);
        updateResult = updRes;

        const summary = {
            message: 'Sync process completed.',
            total_found: rows.length,
            success_count: results.length,
            error_count: errors.length,
            db_updated_rows: updateResult.affectedRows,
            details: {
                successes: results,
                failures: errors
            }
        };

        console.log(`${logPrefix} Sync completed. Success: ${results.length}, Errors: ${errors.length}, DB Updated: ${updateResult.affectedRows}`);
        
        // DB Log: Completion Summary
        await saveLog('INFO', 'gaoff_sync', 'Sync process completed', summary, operatorName);

        return summary;

    } catch (error) {
        console.error(`${logPrefix} Fatal Error:`, error.message);
        await saveLog('ERROR', 'gaoff_sync', 'Fatal Error in Sync Process', { message: error.message }, operatorName);
        throw error; // Re-throw to be handled by caller
    }
}

// Route: POST /api/gaoff (Manual Trigger)
app.post('/api/gaoff', authenticateToken, async (req, res) => {
    try {
        const result = await executeGaOffSync(req.user.username);
        // Log the API Response itself
        await saveLog('INFO', 'api_gaoff_manual', 'Manual Sync Triggered', result, req.user.username);
        return res.status(200).json(result);
    } catch (error) {
        const errorResponse = {
            error: 'Internal Server Error during sync process.',
            details: error.message
        };
        await saveLog('ERROR', 'api_gaoff_manual', 'Manual Sync Error', errorResponse, req.user.username);
        return res.status(500).json(errorResponse);
    }
});

initializeDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`🌐 Express API listening at http://localhost:${PORT}`);
        
        // --- Scheduler Setup ---
        const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes in milliseconds
        console.log(`⏱️  Scheduler started: Auto-syncing gaoff data every 5 minutes.`);
        
        setInterval(async () => {
            try {
                // Call the sync function automatically
                await executeGaOffSync('AUTO_SCHEDULER');
            } catch (err) {
                console.error('❌ Scheduler Error:', err.message);
            }
        }, INTERVAL_MS);
    });
});
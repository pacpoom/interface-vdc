const express = require('express');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

app.use(express.json());

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
        return res.status(401).json({ 
            error: 'Access Denied', 
            message: 'Authorization header format must be "Bearer <token>".' 
        });
    }

    const token = authHeader.split(' ')[1];

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ 
                error: 'Forbidden', 
                message: 'Invalid, expired, or tampered token.' 
            });
        }
        req.user = user; 
        next(); 
    });
};

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body; 

    if (!username || !password) {
        await saveLog('WARN', 'api_login', 'Login Failed: Missing credentials', 'Username or password empty', 'UNKNOWN');
        return res.status(400).json({ error: 'Authentication failed', message: 'Username and password are required.' });
    }

    try {
        const [users] = await pool.query(
            'SELECT id, username, password_hash, api_key_status FROM api_user WHERE username = ?',
            [username]
        );

        const user = users[0];
        if (!user) {
            await saveLog('WARN', 'api_login', 'Login Failed: Invalid Username', `Username: ${username}`, 'UNKNOWN');
            return res.status(401).json({ error: 'Authentication failed', message: 'Invalid username' });
        }
        
        const isPasswordValid = await bcrypt.compare(password, user.password_hash);

        if (!isPasswordValid) {
            await saveLog('WARN', 'api_login', 'Login Failed: Invalid Password', `Username: ${username}`, 'UNKNOWN');
            return res.status(401).json({ error: 'Authentication failed', message: 'Invalid username or password.' });
        }
        
        if (user.api_key_status !== 1) {
            await saveLog('WARN', 'api_login', 'Login Failed: Inactive API Key', `Username: ${username}`, username);
            return res.status(403).json({ error: 'Access Denied', message: 'API key is inactive.' });
        }

        const userPayload = { 
            id: user.id, 
            username: user.username,
            role: user.api_key_status === 1 ? 'active_api' : 'inactive_api' 
        };

        const accessToken = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '1h' });

        // Log successful login
        await saveLog('INFO', 'api_login', `User ${username} logged in`, null, username);

        return res.status(200).json({
            message: `Login successful for user: ${user.username}. Use this token for secured endpoints.`,
            accessToken: accessToken,
            user: userPayload
        });
        
    } catch (error) {
        console.error('Error during login process:', error.message);
        await saveLog('ERROR', 'api_login', 'Internal Server Error', error.message, 'SYSTEM');
        res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
});

app.get('/api/vehicle_no/:vin_number', authenticateToken, async (req, res) => {

    console.log('Authenticated User:', req.user.username, 'Role:', req.user.role); 

    const vinNumber = req.params.vin_number; 

    if (!vinNumber) {
        return res.status(400).json({ error: 'VIN number is required in the path.' });
    }
    
    try {
        // Log the query attempt
        await saveLog('INFO', 'api_get_vehicle', 'Query VIN', `VIN: ${vinNumber}`, req.user.username);

        const [rows] = await pool.query(
            'SELECT * FROM gaoff WHERE vin_number = ?',
            [vinNumber]
        );

        if (rows.length === 0) {
            await saveLog('INFO', 'api_get_vehicle', 'VIN Not Found', `VIN: ${vinNumber}`, req.user.username);
            return res.status(404).json({
                status: 0,
                vin_number: vinNumber,
                message: 'No Data'
            });
        }
        
        const vehicleData = rows[0];

        if (vehicleData.pdiin_flg === 1) {
            return res.status(200).json({ 
            status: 2,
            vehicle_number: vehicleData.vin_number,
            vehicle_code: vehicleData.vc_code,
            engine_code: vehicleData.engine_code,
            ga_off_time: vehicleData.ga_off_time,
            pdiin_flg: vehicleData.pdiin_flg,
            message: 'Received'
            });
        } 
        
        return res.status(200).json({
            status: 1,
            vehicle_number: vehicleData.vin_number,
            vehicle_code: vehicleData.vc_code,
            engine_code: vehicleData.engine_code,
            ga_off_time: vehicleData.ga_off_time,
            pdiin_flg: vehicleData.pdiin_flg,
            message: 'Waiting Receive'
        });
        

    } catch (error) {
        console.error('Error fetching vehicle number:', error.message);
        await saveLog('ERROR', 'api_get_vehicle', 'Error fetching vehicle', error.message, req.user.username);
        res.status(500).json({
            error: 'Internal Server Error while querying the database.',
            details: error.message
        });
    }
});

app.post('/api/receiving', authenticateToken, async (req, res) => {
    
    console.log(`Authenticated User ${req.user.username} attempting to update pdiin_flg.`); 

    const { vin_number, pdiin_flg } = req.body; 

    // Note: Assuming pdiin_flg should be sent as a number (0 or 1)
    if (!vin_number || pdiin_flg === undefined) {
        await saveLog('WARN', 'api_receiving', 'Invalid Input', 'Missing vin_number or pdiin_flg', req.user.username);
        return res.status(400).json({ 
            error: 'Invalid Input', 
            message: 'Both vin_number (string) and pdiin_flg (number) are required in the request body.' 
        });
    }

    const flagValue = parseInt(pdiin_flg, 10);
    if (flagValue !== 0 && flagValue !== 1) {
         await saveLog('WARN', 'api_receiving', 'Invalid Flag Value', `pdiin_flg: ${pdiin_flg}`, req.user.username);
         return res.status(400).json({ 
            error: 'Invalid Flag Value', 
            message: 'pdiin_flg must be either 0 or 1.' 
        });
    }

    try {

        const [checkRows] = await pool.query(
            'SELECT pdiin_flg FROM gaoff WHERE vin_number = ?',
            [vin_number]
        );
        
        if (checkRows.length === 0) {
             await saveLog('WARN', 'api_receiving', 'VIN Not Found', `VIN: ${vin_number}`, req.user.username);
             return res.status(404).json({
                status: 0,
                message: `Failed to update. VIN number '${vin_number}' not found in gaoff table.`,
            });
        }
        
        const currentPdiinFlg = checkRows[0].pdiin_flg;

        if (currentPdiinFlg === 1) {
             await saveLog('INFO', 'api_receiving', 'Already Received', `VIN: ${vin_number}`, req.user.username);
             return res.status(409).json({
                status: 2,
                message: `Vehicle with VIN '${vin_number}' has already been received (pdiin_flg is already 1).`,
            });
        }
        
        const [result] = await pool.query(
            'UPDATE gaoff SET pdiin_flg = ? WHERE vin_number = ?',
            [flagValue, vin_number]
        );


        if (result.affectedRows === 0) {
            await saveLog('ERROR', 'api_receiving', 'Update Failed Unexpectedly', `VIN: ${vin_number}`, req.user.username);
            return res.status(500).json({
                status: 0,
                message: `Update failed unexpectedly for VIN: ${vin_number}.`,
            });
        }
        
        // Log Receiving Update
        await saveLog('INFO', 'api_receiving', `Updated pdiin_flg to ${flagValue}`, `VIN: ${vin_number}`, req.user.username);

        return res.status(200).json({
            status: 1,
            message: `Successfully updated pdiin_flg to ${flagValue} for VIN: ${vin_number}.`,
            currentPdiinFlg: currentPdiinFlg,
            rows_affected: result.affectedRows
        });

    } catch (error) {
        console.error('Error updating pdiin_flg:', error.message);
        await saveLog('ERROR', 'api_receiving', 'Error updating pdiin_flg', error.message, req.user.username);
        res.status(500).json({
            error: 'Internal Server Error while updating the database.',
            details: error.message
        });
    }
});

// New Route: PUT /api/delivery (Secured)
app.put('/api/delivery', authenticateToken, async (req, res) => {
    
    console.log(`Authenticated User ${req.user.username} attempting to update delivery_flg.`); 

    const { vin_number } = req.body; 

    if (!vin_number) {
        await saveLog('WARN', 'api_delivery', 'Invalid Input', 'Missing vin_number', req.user.username);
        return res.status(400).json({ 
            error: 'Invalid Input', 
            message: 'VIN number is required in the request body.' 
        });
    }

    try {
        // SELECT delivery_flg and pdiin_flg
        const [rows] = await pool.query(
            'SELECT delivery_flg, pdiin_flg FROM gaoff WHERE vin_number = ?',
            [vin_number]
        );
        
        const vehicleData = rows[0];

        // Check if VIN exists
        if (rows.length === 0) {
            await saveLog('WARN', 'api_delivery', 'VIN Not Found', `VIN: ${vin_number}`, req.user.username);
            return res.status(404).json({
                status: 0, // Not Found
                message: `VIN number '${vin_number}' not found in System.`,
                vin_number: vin_number
            });
        }

        // Condition 1: delivery_flg == 1 (Vehicle already delivered)
        if (vehicleData.delivery_flg === 1) {
            await saveLog('INFO', 'api_delivery', 'Already Delivered', `VIN: ${vin_number}`, req.user.username);
            return res.status(200).json({
                status: 2, // Custom status for already delivered
                message: `Vehicle with VIN '${vin_number}' is already marked as delivered.`,
                vin_number: vin_number
            });
        }

        // Condition 2: pdiin_flg == 0 (Waiting Receive/PDI Incomplete)
        if (vehicleData.pdiin_flg === 0) {
            await saveLog('INFO', 'api_delivery', 'Waiting Receive', `VIN: ${vin_number} (pdiin=0)`, req.user.username);
            return res.status(200).json({
                status: 3, // Custom status for waiting receive
                message: `Vehicle with VIN '${vin_number}' is waiting for receive (pdiin_flg = 0). Cannot set delivery_flg.`,
                vin_number: vin_number
            });
        }

        //Condition 3: delivery_flg == 0 AND pdiin_flg == 1 (Ready to update)
        if (vehicleData.delivery_flg === 0 && vehicleData.pdiin_flg === 1) {
             const [updateResult] = await pool.query(
                'UPDATE gaoff SET delivery_flg = 1 WHERE vin_number = ?',
                [vin_number]
            );

            if (updateResult.affectedRows === 1) {
                
                await saveLog('INFO', 'api_delivery', 'Delivery Update Success', `VIN: ${vin_number}`, req.user.username);

                return res.status(200).json({
                    status: 1, // Success status
                    message: `Successfully updated delivery_flg to 1 for VIN: ${vin_number}.`,
                    vin_number: vin_number
                });
            }
        }
        
        await saveLog('ERROR', 'api_delivery', 'Logic Error', `VIN: ${vin_number}`, req.user.username);
        return res.status(500).json({
            error: 'Internal Logic Error',
            message: 'An unexpected state occurred during the delivery flag update process.'
        });

    } catch (error) {
        console.error('Error updating delivery_flg:', error.message);
        await saveLog('ERROR', 'api_delivery', 'Error updating delivery_flg', error.message, req.user.username);
        res.status(500).json({
            error: 'Internal Server Error while querying the database.',
            details: error.message
        });
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
    await saveLog('INFO', 'gaoff_sync', 'Sync process started', null, operatorName);

    const TARGET_URL = 'https://gvwms-uat.anji-logistics.com/dataway/api';
    const HEADERS = {
        'Content-Type': 'application/json;charset=utf-8',
        'appId': '20251208061317673',
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
            await saveLog('INFO', 'gaoff_sync', 'No pending records found', 'Count: 0', operatorName);
            return {
                message: 'No pending records found (api_flg = 0).',
                processed_count: 0
            };
        }

        console.log(`${logPrefix} Found ${rows.length} records to sync.`);
        await saveLog('INFO', 'gaoff_sync', `Found ${rows.length} records`, null, operatorName);

        const results = [];
        const errors = [];

        // 2. Loop & Post
        for (const row of rows) {
            const payload = {
                vinCode: row.vinCode,
                materialCode: row.materialCode,
                engine_code: row.enginecode, 
                productionDate: formatDateForAnji(row.productionDate),
                flag: row.flag !== null ? String(row.flag) : "0"
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
                    await saveLog('ERROR', 'gaoff_sync', `Failed to send VIN ${row.vinCode}`, JSON.stringify(responseData), operatorName);
                    errors.push({ vin: row.vinCode, status: 'failed', error: responseData });
                }

            } catch (err) {
                console.error(`${logPrefix} Network error sending VIN ${row.vinCode}:`, err.message);
                // DB Log: Network Error
                await saveLog('ERROR', 'gaoff_sync', `Network error VIN ${row.vinCode}`, err.message, operatorName);
                errors.push({ vin: row.vinCode, status: 'network_error', error: err.message });
            }
        }

        // 3. Update DB
        let updateResult = { affectedRows: 0 };
        const sqlUpdate = `UPDATE gaoff SET api_flg = 1 WHERE api_flg = 0;`;
        const [updRes] = await pool.query(sqlUpdate);
        updateResult = updRes;

        console.log(`${logPrefix} Sync completed. Success: ${results.length}, Errors: ${errors.length}, DB Updated: ${updateResult.affectedRows}`);
        
        // DB Log: Completion Summary
        await saveLog('INFO', 'gaoff_sync', 'Sync process completed', 
            JSON.stringify({
                found: rows.length,
                success: results.length,
                errors: errors.length,
                db_updated: updateResult.affectedRows
            }), 
            operatorName
        );

        return {
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

    } catch (error) {
        console.error(`${logPrefix} Fatal Error:`, error.message);
        await saveLog('ERROR', 'gaoff_sync', 'Fatal Error in Sync Process', error.message, operatorName);
        throw error; // Re-throw to be handled by caller
    }
}

// Route: POST /api/gaoff (Manual Trigger)
app.post('/api/gaoff', authenticateToken, async (req, res) => {
    try {
        const result = await executeGaOffSync(req.user.username);
        return res.status(200).json(result);
    } catch (error) {
        return res.status(500).json({
            error: 'Internal Server Error during sync process.',
            details: error.message
        });
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
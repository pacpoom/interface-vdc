// โหลดแพ็กเกจที่จำเป็น
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

// Route: GET /
app.get('/', (req, res) => {
    res.send('<h1>Express Server Running</h1><p>Database connection status printed in console. Use /api/login to get a token.</p>');
});


app.post('/api/login', async (req, res) => {
    const { username, password } = req.body; 

    if (!username || !password) {
        return res.status(400).json({ error: 'Authentication failed', message: 'Username and password are required.' });
    }

    try {
        const [users] = await pool.query(
            'SELECT id, username, password_hash, api_key_status FROM api_user WHERE username = ?',
            [username]
        );

        const user = users[0];
        if (!user) {
            return res.status(401).json({ error: 'Authentication failed', message: 'Invalid username' });
        }
        
        const isPasswordValid = await bcrypt.compare(password, user.password_hash);

        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Authentication failed', message: 'Invalid username or password.' });
        }
        
        if (user.api_key_status !== 1) {
            return res.status(403).json({ error: 'Access Denied', message: 'API key is inactive.' });
        }

        const userPayload = { 
            id: user.id, 
            username: user.username,
            role: user.api_key_status === 1 ? 'active_api' : 'inactive_api' 
        };

        const accessToken = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '1h' });

        return res.status(200).json({
            message: `Login successful for user: ${user.username}. Use this token for secured endpoints.`,
            accessToken: accessToken,
            user: userPayload
        });
        
    } catch (error) {
        console.error('Error during login process:', error.message);
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
        const [rows] = await pool.query(
            'SELECT * FROM gaoff WHERE vin_number = ?',
            [vinNumber]
        );

        if (rows.length === 0) {
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
        res.status(500).json({
            error: 'Internal Server Error while querying the database.',
            details: error.message
        });
    }
});

app.put('/api/receiving', authenticateToken, async (req, res) => {
    
    console.log(`Authenticated User ${req.user.username} attempting to update pdiin_flg.`); 

    const { vin_number, pdiin_flg } = req.body; 

    // Note: Assuming pdiin_flg should be sent as a number (0 or 1)
    if (!vin_number || pdiin_flg === undefined) {
        return res.status(400).json({ 
            error: 'Invalid Input', 
            message: 'Both vin_number (string) and pdiin_flg (number) are required in the request body.' 
        });
    }

    const flagValue = parseInt(pdiin_flg, 10);
    if (flagValue !== 0 && flagValue !== 1) {
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
             return res.status(404).json({
                status: 0,
                message: `Failed to update. VIN number '${vin_number}' not found in gaoff table.`,
            });
        }
        
        const currentPdiinFlg = checkRows[0].pdiin_flg;

        if (currentPdiinFlg === 1) {
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
            return res.status(500).json({
                status: 0,
                message: `Update failed unexpectedly for VIN: ${vin_number}.`,
            });
        }
        
        return res.status(200).json({
            status: 1,
            message: `Successfully updated pdiin_flg to ${flagValue} for VIN: ${vin_number}.`,
            currentPdiinFlg: currentPdiinFlg,
            rows_affected: result.affectedRows
        });

    } catch (error) {
        console.error('Error updating pdiin_flg:', error.message);
        res.status(500).json({
            error: 'Internal Server Error while updating the database.',
            details: error.message
        });
    }
});

// New Route: PUT /api/PGI (Secured)
app.put('/api/delivery', authenticateToken, async (req, res) => {
    
    console.log(`Authenticated User ${req.user.username} attempting to update delivery_flg.`); 

    const { vin_number } = req.body; 

    if (!vin_number) {
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
            return res.status(404).json({
                status: 0, // Not Found
                message: `VIN number '${vin_number}' not found in System.`,
                vin_number: vin_number
            });
        }

        // Condition 1: delivery_flg == 1 (Vehicle already delivered)
        if (vehicleData.delivery_flg === 1) {
            return res.status(200).json({
                status: 2, // Custom status for already delivered
                message: `Vehicle with VIN '${vin_number}' is already marked as delivered.`,
                vin_number: vin_number
            });
        }

        // Condition 2: pdiin_flg == 0 (Waiting Receive/PDI Incomplete)
        if (vehicleData.pdiin_flg === 0) {
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
                return res.status(200).json({
                    status: 1, // Success status
                    message: `Successfully updated delivery_flg to 1 for VIN: ${vin_number}.`,
                    vin_number: vin_number
                });
            }
        }
        
        return res.status(500).json({
            error: 'Internal Logic Error',
            message: 'An unexpected state occurred during the delivery flag update process.'
        });

    } catch (error) {
        console.error('Error updating delivery_flg:', error.message);
        res.status(500).json({
            error: 'Internal Server Error while querying the database.',
            details: error.message
        });
    }
});

initializeDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`🌐 Express API listening at http://localhost:${PORT}`);
    });
});
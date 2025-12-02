// โหลดแพ็กเกจที่จำเป็น
const express = require('express');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken'); // 1. โหลดแพ็กเกจ JWT
const bcrypt = require('bcrypt'); // **สำคัญ:** ติดตั้งและใช้ bcrypt สำหรับการเปรียบเทียบรหัสผ่าน
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ดึง Secret Key จาก .env
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret'; // ใช้ Secret Key ที่ซับซ้อน

// --- Middleware สำหรับ Express ---
app.use(express.json());

// --- ตั้งค่าการเชื่อมต่อฐานข้อมูล ---
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
};

let pool; // Connection Pool

// ฟังก์ชันสำหรับทดสอบการเชื่อมต่อ (เหมือนเดิม)
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
        // หากเชื่อมต่อไม่สำเร็จ จะแสดง Error พร้อมคำแนะนำ
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

// 2. Authentication Middleware: ฟังก์ชันสำหรับตรวจสอบ Token (ปรับปรุงการตรวจสอบรูปแบบ Bearer)
const authenticateToken = (req, res, next) => {
    // ดึง Token จาก Header 'Authorization' (รูปแบบ: Bearer <token>)
    const authHeader = req.headers['authorization'];
    
    // 1. ตรวจสอบว่ามี Header 'Authorization' และขึ้นต้นด้วย 'Bearer ' หรือไม่
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ 
            error: 'Access Denied', 
            message: 'Authorization header format must be "Bearer <token>".' 
        });
    }

    // 2. แยกเอาเฉพาะส่วน Token
    const token = authHeader.split(' ')[1];

    // ตรวจสอบความถูกต้องของ Token
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            // Token ไม่ถูกต้อง, หมดอายุ หรือไม่ตรงกับ Secret Key
            return res.status(403).json({ 
                error: 'Forbidden', 
                message: 'Invalid, expired, or tampered token.' 
            });
        }
        req.user = user; // เก็บข้อมูลผู้ใช้ที่ถอดรหัสได้ไว้ใน Request
        next(); // ไปยัง Route Handler ต่อไป
    });
};


// --- API Routes ---

// Route สำหรับหน้าแรก
app.get('/', (req, res) => {
    res.send('<h1>Express Server Running</h1><p>Database connection status printed in console. Use /api/login to get a token.</p>');
});

// 3. New Route: POST /api/login - สำหรับรับ Username/Password และสร้าง JWT
// ปรับปรุง: ใช้ตาราง api_user ในการตรวจสอบ Username
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body; // รับค่า username และ password

    if (!username || !password) {
        return res.status(400).json({ error: 'Authentication failed', message: 'Username and password are required.' });
    }

    try {
        // 1. ค้นหาผู้ใช้จากตาราง api_user
        const [users] = await pool.query(
            // ดึง password_hash และ api_key_status จากตาราง api_user
            'SELECT id, username, password_hash, api_key_status FROM api_user WHERE username = ?',
            [username]
        );

        const user = users[0];

        // 2. ตรวจสอบว่าพบผู้ใช้หรือไม่
        if (!user) {
            return res.status(401).json({ error: 'Authentication failed', message: 'Invalid username or password.' });
        }
        
        // 3. *** ส่วนการตรวจสอบรหัสผ่าน (Password Validation) ***
        // ใช้ bcrypt เพื่อเปรียบเทียบรหัสผ่าน (password) กับ HASH (user.password_hash)
        const isPasswordValid = await bcrypt.compare(password, user.password_hash);

        if (!isPasswordValid) {
            // รหัสผ่านไม่ถูกต้อง
            return res.status(401).json({ error: 'Authentication failed', message: 'Invalid username or password.' });
        }
        
        // 4. ตรวจสอบสถานะ API Key
        if (user.api_key_status !== 1) {
            return res.status(403).json({ error: 'Access Denied', message: 'API key is inactive.' });
        }

        // 5. สร้าง Payload: ข้อมูลที่จะเก็บใน Token
        const userPayload = { 
            id: user.id, 
            username: user.username,
            // กำหนด Role ตาม api_key_status
            role: user.api_key_status === 1 ? 'active_api' : 'inactive_api' 
        };

        // 6. สร้าง Token
        const accessToken = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '1h' }); // Token หมดอายุใน 1 ชั่วโมง

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


// Route สำหรับทดสอบการดึงข้อมูลจากฐานข้อมูล (ไม่ปลอดภัย - ไม่ต้องใช้ Token)
app.get('/api/testdb', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM users LIMIT 5'); 
        
        res.status(200).json({
            message: 'Data fetched successfully from MySQL!',
            data: rows
        });

    } catch (error) {
        console.error('Error executing query:', error.message);
        res.status(500).json({
            error: 'Failed to fetch data. Check if the table "users" exists or if the query is valid.',
            details: error.message
        });
    }
});

// New Route: GET /api/vehicle_no/:vin_number (Secured)
// *** ใช้ Middleware: authenticateToken เพื่อบังคับให้ต้องส่ง Token มาด้วย ***
app.get('/api/vehicle_no/:vin_number', authenticateToken, async (req, res) => {
    
    // ตรวจสอบว่าผู้ใช้ที่เข้าถึงคือใคร (ข้อมูลจาก Token)
    console.log('Authenticated User:', req.user.username, 'Role:', req.user.role); 

    const vinNumber = req.params.vin_number; 

    if (!vinNumber) {
        return res.status(400).json({ error: 'VIN number is required in the path.' });
    }
    
    try {
        // ดึงข้อมูลทั้งหมดจาก gcms_gaoff ตาม vin_number
        const [rows] = await pool.query(
            'SELECT * FROM gcms_gaoff WHERE vin_number = ?',
            [vinNumber]
        );

        // สถานะ 0: ไม่พบ VIN Number
        if (rows.length === 0) {
            return res.status(404).json({
                status: 0,
                vin_number: vinNumber
            });
        }
        
        const vehicleData = rows[0];

        // สถานะ 2: พบ VIN Number แต่ pdiin_flg = 1
        if (vehicleData.pdiin_flg === 1) {
            return res.status(200).json({ // เปลี่ยนเป็น 200 เพราะข้อมูลถูกดึงมาแล้ว แต่มีสถานะเฉพาะ
                status: 2,
                vin_number: vinNumber,
                message: 'VIN number found, but PDI-IN flag is set (pdiin_flg = 1).'
            });
        } 
        
        // สถานะ 1: พบ VIN Number และ pdiin_flg != 1
        return res.status(200).json({
            status: 1,
            vehicle_number: vehicleData.serial_number, // เปลี่ยนจาก vin_number เป็น serial_number ตามโครงสร้างตาราง
            vehicle_code: vehicleData.vc_code,
            engine_code: vehicleData.engine_code,
            ga_off_time: vehicleData.ga_off_time,
            pdiin_flg: vehicleData.pdiin_flg,
        });
        

    } catch (error) {
        console.error('Error fetching vehicle number:', error.message);
        res.status(500).json({
            error: 'Internal Server Error while querying the database.',
            details: error.message
        });
    }
});


// --- เริ่มต้นเซิร์ฟเวอร์ ---

// เริ่มต้นการเชื่อมต่อฐานข้อมูลก่อน แล้วค่อยรัน Express Server
initializeDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`🌐 Express API listening at http://localhost:${PORT}`);
    });
});
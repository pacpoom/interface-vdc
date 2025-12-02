const bcrypt = require('bcrypt');

// *************** แก้ไขตรงนี้ ***************
const plainPassword = 'P@ss1234'; 
const saltRounds = 10; // ค่ามาตรฐานที่ใช้สร้าง Hash (ต้องตรงกับตอนสร้าง Hash ในฐานข้อมูล)
// *****************************************


async function generateHash() {
    try {
        const hash = await bcrypt.hash(plainPassword, saltRounds);
        console.log('\n--- BCrypt Hash Result ---');
        console.log(`Original Password: ${plainPassword}`);
        console.log(`Generated Hash: ${hash}`);
        console.log('--------------------------\n');
        console.log('*** กรุณานำ Hash ด้านบนนี้ไปอัปเดตในคอลัมน์ `password_hash` ของตาราง `api_user` ***');
    } catch (error) {
        console.error('Error generating hash:', error);
    }
}

generateHash();
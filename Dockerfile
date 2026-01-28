# ใช้ Base Image เป็น Node.js เวอร์ชั่น 18 (LTS) แบบ Slim
FROM node:18-slim

# สร้าง Directory ทำงานใน Container
WORKDIR /app

# Copy ไฟล์ package.json และ package-lock.json ก่อนเพื่อใช้ Cache
COPY package*.json ./

# ติดตั้ง Dependencies
RUN npm install

# Copy โค้ดทั้งหมด
COPY . .

# เปิด Port 4001 (เพื่อให้ตรงกับค่าใน .env และ docker-compose)
EXPOSE 4001

# คำสั่งรันโปรแกรม
CMD ["node", "server.js"]
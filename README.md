# Dragon & Aviator Hub — Online

Đây là bản chuyển đổi từ file HTML gốc sang kiến trúc có server. Game vẫn dùng **xu ảo**, không có nạp/rút tiền thật.

## Chạy trên máy
1. Cài Node.js 20+.
2. Mở terminal trong thư mục dự án.
3. Chạy `npm install`.
4. Chạy `npm start`.
5. Mở `http://localhost:3000`.

Database SQLite (`game.sqlite`) sẽ tự tạo.

## Đưa lên internet
Có thể deploy Node.js app lên một máy chủ/VPS hoặc dịch vụ hỗ trợ Node. Cần đặt `PORT` theo môi trường deploy.

## Điểm đã thay đổi
- Tài khoản và mật khẩu được lưu ở server, mật khẩu hash bằng `scrypt`.
- Session dùng token server.
- Số dư nằm trong SQLite, không còn tin vào `localStorage` để quyết định tiền.
- Tài Xỉu: server tạo xúc xắc và tính thắng/thua.
- Aviator: server giữ mốc crash và xác thực cashout.
- Frontend vẫn giữ giao diện/gameplay của file gốc.

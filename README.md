# Sapo -> Lark Base Middleware

Flow khuyen dung cho shop nho dang ban tren Shopee va da dung Sapo:

```text
Shopee -> Sapo -> Webhook Sapo -> Server nay -> SQLite -> Bao cao doanh thu/top san pham
```

Ly do chon flow nay:

- Khong phu thuoc Shopee Open API, vi shop nho thuong kho duoc cap quyen.
- Sapo da co san ket noi Shopee, nen minh lay don tu Sapo se on dinh hon.
- Server luu du lieu toi thieu de tinh doanh thu va san pham ban chay.
- Neu can, co the gui bao cao tong hop sang Lark chat.

Shopee Open API van duoc giu trong code, nhung chi nen dung neu sau nay ban duoc Shopee cap API.

## 1. Tao Lark Base

Buoc nay chi bat buoc neu ban muon day tung don vao Lark Base. Neu chi can xem doanh thu/top san pham, co the bo qua Lark Base.

Tao mot Base/Bitable trong Lark voi bang don hang. Nen tao cac cot sau:

| Ten cot | Kieu goi y | Noi dung |
| --- | --- | --- |
| `Ma don` | Text | Ma don tu Sapo/Shopee |
| `Nguon` | Text | `sapo` |
| `San` | Text | `shopee`, `sapo`, `lazada`... |
| `Trang thai` | Text | Trang thai don |
| `Doanh thu` | Number/Currency | Tong tien don |
| `Giam gia` | Number/Currency | Giam gia |
| `Phi van chuyen` | Number/Currency | Phi van chuyen |
| `Khach hang` | Text | Ten khach |
| `San pham` | Long text | Danh sach san pham |
| `Anh thiet ke` | Long text/URL | Link anh/file thiet ke |
| `Ngay tao` | Text/Date | Ngay tao don |
| `Cap nhat luc` | Text/Date | Lan cap nhat cuoi |

Lay 2 gia tri cua Base:

- `LARK_BASE_APP_TOKEN`: nam trong URL cua Base.
- `LARK_BASE_TABLE_ID`: id cua bang can ghi don.

## 2. Tao Lark App

Trong Lark Developer Console:

1. Tao internal app.
2. Lay `App ID` va `App Secret`.
3. Cap quyen cho Bitable/Base, toi thieu quyen doc/ghi record cua Base.
4. Neu muon gui tin nhan bao cao vao chat, them quyen `im:message:send_as_bot` va lay `LARK_CHAT_ID`.

Can dien vao `.env`:

```env
LARK_APP_ID=
LARK_APP_SECRET=
LARK_BASE_APP_TOKEN=
LARK_BASE_TABLE_ID=
```

`LARK_CHAT_ID` la tuy chon. Co thi bot gui bao cao ngay, khong co thi van dong bo don vao Base.

## 3. Cau hinh .env

Flow chinh:

```env
INTEGRATION_MODE=sapo_webhook
SHOP_NAME=Ten shop cua ban
SYNC_ORDER_DETAILS_TO_LARK=false

SAPO_STORE=ten-shop-sapo
SAPO_WEBHOOK_VERIFY_TOKEN=mot_chuoi_bi_mat_tu_dat

LARK_APP_ID=cli_xxxxxx
LARK_APP_SECRET=xxxxxx
LARK_BASE_APP_TOKEN=base_or_bitable_app_token
LARK_BASE_TABLE_ID=tbl_xxxxxx
LARK_ORDER_UNIQUE_FIELD=Ma don
```

Voi nhu cau chi xem doanh thu/top san pham, de:

```env
SYNC_ORDER_DETAILS_TO_LARK=false
```

Khi do server khong day tung don len Lark Base.

Mapping cot Lark Base mac dinh:

```env
LARK_FIELD_SOURCE=Nguon
LARK_FIELD_PLATFORM=San
LARK_FIELD_STATUS=Trang thai
LARK_FIELD_REVENUE=Doanh thu
LARK_FIELD_DISCOUNT=Giam gia
LARK_FIELD_SHIPPING=Phi van chuyen
LARK_FIELD_CUSTOMER=Khach hang
LARK_FIELD_PRODUCTS=San pham
LARK_FIELD_IMAGES=Anh thiet ke
LARK_FIELD_CREATED_AT=Ngay tao
LARK_FIELD_UPDATED_AT=Cap nhat luc
```

Nếu tên cột trong Base khác, đổi các biến `LARK_FIELD_*` cho khớp.

## 4. Ket noi Shopee vao Sapo

Trong Sapo:

1. Vao kenh ban hang / san TMĐT.
2. Ket noi gian hang Shopee.
3. Dam bao don Shopee da dong bo ve Sapo.
4. Kiem tra trong Sapo co thay ma don, san pham, thong tin khach va ghi chu/link anh thiet ke.

Neu anh thiet ke dang nam trong ghi chu, custom field, note attribute, link Google Drive/Canva, server se co gang trich link va day vao cot `Anh thiet ke`.

## 5. Tao webhook Sapo

Tao webhook don hang trong Sapo tro ve server:

```text
POST https://your-domain.com/api/webhooks/sapo/order
```

Neu Sapo cho gan query string, dung:

```text
https://your-domain.com/api/webhooks/sapo/order?token=mot_chuoi_bi_mat_tu_dat
```

`token` nay phai trung voi:

```env
SAPO_WEBHOOK_VERIFY_TOKEN=mot_chuoi_bi_mat_tu_dat
```

Nen bat cac su kien:

- Tao don moi.
- Cap nhat don.
- Thanh toan don, neu co.
- Huy/hoan don, neu co.

### API_KEY/API_SECRET cua Sapo dung luc nao?

Neu ban tao webhook truc tiep trong giao dien Sapo thi chua can `SAPO_API_KEY`, `SAPO_API_SECRET`, `SAPO_ACCESS_TOKEN`.

Can dien toi thieu:

```env
SAPO_STORE=ten-shop-sapo
SAPO_WEBHOOK_VERIFY_TOKEN=mot_chuoi_bi_mat_tu_dat
```

`SAPO_WEBHOOK_VERIFY_TOKEN` la chuoi minh tu dat, vi du:

```env
SAPO_WEBHOOK_VERIFY_TOKEN=maxu_sapo_webhook_2026
```

Sau do URL webhook trong Sapo la:

```text
https://your-domain.com/api/webhooks/sapo/order?token=maxu_sapo_webhook_2026
```

Chi can `SAPO_API_KEY` va `SAPO_API_SECRET` khi:

- Muon goi Sapo API de keo don cu ve Lark Base.
- Muon tu dong tao webhook bang API thay vi tao trong giao dien Sapo.
- Muon dong bo them san pham, ton kho, khach hang.

Theo OAuth cua Sapo, `API_KEY` va `API_SECRET` duoc dung de lay `SAPO_ACCESS_TOKEN`. Access token moi la gia tri dung khi goi API doc/ghi du lieu shop.

## 6. Chay server

```bash
npm install
npm start
```

Kiem tra server:

```bash
curl http://localhost:3000/api/health
```

Neu dung local, webhook Sapo can URL public. Co the dung ngrok/cloudflared/VPS:

```text
https://abc.ngrok-free.app/api/webhooks/sapo/order?token=mot_chuoi_bi_mat_tu_dat
```

## 7. Test webhook truoc khi noi that

```bash
curl -X POST http://localhost:3000/api/webhooks/sapo/order \
  -H "Content-Type: application/json" \
  -d '{
    "order": {
      "id": 999,
      "name": "#SAPO-TEST-001",
      "source_name": "Shopee",
      "status": "open",
      "financial_status": "paid",
      "total_price": "350000",
      "customer": {
        "first_name": "Nguyen",
        "last_name": "A",
        "phone": "0900000000"
      },
      "note_attributes": [
        {
          "name": "design_image",
          "value": "https://example.com/mockup.jpg"
        }
      ],
      "line_items": [
        {
          "sku": "SKU-1",
          "name": "Ao thun custom",
          "quantity": 1,
          "price": "350000"
        }
      ]
    }
  }'
```

Xem don da nhan:

```bash
curl http://localhost:3000/api/orders
```

Xem tong hop doanh thu va san pham ban chay hom nay:

```bash
curl http://localhost:3000/api/analytics/summary
```

Xem tong hop theo ngay:

```bash
curl "http://localhost:3000/api/analytics/summary?date=2026-05-22"
```

Xem tong hop theo khoang ngay:

```bash
curl "http://localhost:3000/api/analytics/summary?from=2026-05-01&to=2026-05-22"
```

## 8. Van hanh hang ngay

Server lam 3 viec:

1. Nhan webhook Sapo va luu don vao SQLite.
2. Tinh doanh thu, so don, gia tri trung binh/don, top san pham.
3. Chay bao cao ngay theo `REPORT_CRON`, mac dinh 8:00 sang.

Neu bat `SYNC_ORDER_DETAILS_TO_LARK=true`, server moi upsert tung don vao Lark Base theo cot `Ma don`.

## 9. Khi nao moi dung Shopee Open API?

Chi dung khi ban co du:

```env
INTEGRATION_MODE=shopee_api
SHOPEE_PARTNER_ID=
SHOPEE_API_SECRET=
SHOPEE_SHOP_ID=
SHOPEE_ACCESS_TOKEN=
SHOPEE_REFRESH_TOKEN=
```

Neu chua duoc Shopee cap API, khong nen mat thoi gian o nhanh nay. Hay di qua Sapo.

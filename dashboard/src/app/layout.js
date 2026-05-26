import { Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

export const metadata = {
  title: "Báo Cáo Tài Chính Shopee Daily - Lark Bitable",
  description: "Dashboard thể hiện sự báo cáo doanh thu Shopee hàng ngày liên kết Sapo Go",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} h-full antialiased dark`}
    >
      <body 
        className="min-h-full flex flex-col font-sans bg-[#090a0f] text-[#f3f4f6] antialiased" 
        style={{ fontFamily: "var(--font-outfit), sans-serif" }}
      >
        {children}
      </body>
    </html>
  );
}

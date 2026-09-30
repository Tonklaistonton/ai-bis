import '../css/style.css';
import '../css/components.css';
import '../css/next-app.css';
import AppProvider from '../components/AppProvider';
import AppShell from '../components/AppShell';

export const metadata = {
  title: 'AIZEN Responder — แชท LINE & อีเมล',
  description: 'แผงควบคุมตอบแชท LINE และส่งอีเมล SMTP ของร้าน'
};

export default function RootLayout({ children }) {
  return (
    <html lang="th">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="dark-theme">
        <AppProvider>
          <AppShell>{children}</AppShell>
        </AppProvider>
      </body>
    </html>
  );
}

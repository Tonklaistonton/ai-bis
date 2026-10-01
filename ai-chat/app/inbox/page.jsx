export const metadata = { title: 'กล่องข้อความรวม — AIZEN Responder' };

export default function InboxPage() {
  return (
    <div style={{ width: '100%', height: 'calc(100vh - 64px)', position: 'relative', overflow: 'hidden' }}>
      <iframe
        src="/unified-inbox.html"
        title="AIZEN Unified Multi-Channel Inbox"
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          display: 'block'
        }}
      />
    </div>
  );
}

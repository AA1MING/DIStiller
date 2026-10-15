
function SubModal({ title, onClose, children }) {
  return <div className="card modal-card app-modal-card-anim" style={{ position: 'fixed', inset: 0, margin: 0, borderRadius: 0, zIndex: 20, overflow: 'auto', background: 'rgba(245,244,237,0.98)' }}>
    <div className="opp-head" style={{ position: 'sticky', top: 0, background: 'var(--surface)', padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
      <h2 style={{ margin: 0, fontSize: 20 }}>{title}</h2><button className="btn danger" onClick={onClose}>关闭</button>
    </div>
    <div style={{ padding: 20 }}>{children}</div>
  </div>
}


export default SubModal

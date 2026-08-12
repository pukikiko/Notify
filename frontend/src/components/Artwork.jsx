import React, { useState } from 'react'

export default function Artwork({ src, alt, className = '', style, rounded }) {
  const [failed, setFailed] = useState(false)
  const cls = `art ${rounded ? 'rounded' : ''} ${className}`
  if (!src || failed) {
    return (
      <div className={`${cls} placeholder-art`} style={{ ...style }}>
        <span style={{ fontSize: style?.fontSize ? style.fontSize : 22, opacity: 0.6 }}>♪</span>
      </div>
    )
  }
  return <img className={cls} src={src} alt={alt || ''} style={style} loading="lazy" onError={() => setFailed(true)} />
}

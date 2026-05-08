import { ImageResponse } from 'next/og'

// Square brand icon for browsers + PWA. Dark surface with the
// CreatorVC "VC" mark in brand blue, matching the in-app Logo.
export const size = { width: 512, height: 512 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#09090b',
          borderRadius: 96,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'sans-serif',
            fontWeight: 900,
            lineHeight: 1,
          }}
        >
          <span style={{ color: '#ffffff', fontSize: 70, letterSpacing: 4 }}>CREATOR</span>
          <span style={{ color: '#3B9EE8', fontSize: 240, letterSpacing: -6, marginTop: 16 }}>VC</span>
        </div>
      </div>
    ),
    { ...size },
  )
}

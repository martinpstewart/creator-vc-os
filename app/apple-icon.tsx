import { ImageResponse } from 'next/og'

// iOS Add-to-Home-Screen icon. iOS strips transparency and applies its
// own rounded mask, so we draw a fully filled square (no border-radius).
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
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
          <span style={{ color: '#ffffff', fontSize: 24, letterSpacing: 1.5 }}>CREATOR</span>
          <span style={{ color: '#3B9EE8', fontSize: 84, letterSpacing: -2, marginTop: 6 }}>VC</span>
        </div>
      </div>
    ),
    { ...size },
  )
}

export default function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizes = {
    sm: 'text-xl tracking-tight',
    md: 'text-2xl tracking-tight',
    lg: 'text-4xl tracking-tight',
  }
  return (
    <span className={`font-black ${sizes[size]} leading-none`}>
      <span className="text-white">CREATOR</span>
      <span className="text-[#3B9EE8]">VC</span>
    </span>
  )
}

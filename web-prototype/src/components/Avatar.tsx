import { useRef } from 'react';

const TONES = ['#16C060', '#0F9A4C', '#2F3631', '#1E6B45', '#5E7A66', '#0B7A3C'];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Profile picture: the uploaded photo, or a default portrait tinted per person. */
export function Avatar({ name, photo, size = 44 }: { name: string; photo?: string | null; size?: number }) {
  if (photo) return <img className="avatar" src={photo} alt={`${name}'s profile photo`} width={size} height={size} />;
  return (
    <svg className="avatar" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={`${name}'s profile picture`}>
      <rect width="64" height="64" fill={TONES[hash(name) % TONES.length]} />
      <circle cx="32" cy="25" r="11" fill="#fff" fillOpacity="0.92" />
      <path d="M10 66c1.5-14 10.5-22 22-22s20.5 8 22 22z" fill="#fff" fillOpacity="0.92" />
    </svg>
  );
}

/** Large avatar with a camera button that replaces the photo (resized to 256 px before saving). */
export function EditableAvatar({ name, photo, onChange, size = 96 }: { name: string; photo: string | null; onChange: (dataUrl: string | null) => void; size?: number }) {
  const input = useRef<HTMLInputElement>(null);
  const pick = (file: File | undefined) => {
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const s = 256;
      const c = document.createElement('canvas');
      c.width = c.height = s;
      const k = Math.max(s / img.width, s / img.height);
      const w = img.width * k;
      const h = img.height * k;
      c.getContext('2d')!.drawImage(img, (s - w) / 2, (s - h) / 2, w, h);
      onChange(c.toDataURL('image/jpeg', 0.85));
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  };
  return (
    <div className="avatar-edit" style={{ width: size, height: size }}>
      <Avatar name={name} photo={photo} size={size} />
      <button className="cam" aria-label={photo ? 'Change profile photo' : 'Add profile photo'} onClick={() => input.current?.click()}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
          <circle cx="12" cy="13" r="3.5" />
        </svg>
      </button>
      <input ref={input} id="photo-input" type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
    </div>
  );
}

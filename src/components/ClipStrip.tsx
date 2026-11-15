import { useRef, useState } from 'react';
import { importFiles } from '../lib/projectIO';
import { toast } from './Toast';

/** File picker for adding videos and photos to the main track. */
export function useImport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const open = () => inputRef.current?.click();
  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="video/*,image/*,.mov,.mp4,.m4v"
      multiple
      hidden
      data-testid="file-input"
      onChange={async (e) => {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        if (!files.length) return;
        const n = await importFiles(files, setStatus);
        setStatus(null);
        if (n > 0) toast(`Added ${n} clip${n > 1 ? 's' : ''}`, 'success', 2500);
      }}
    />
  );
  return { open, input, status };
}

/** Generic one-off file picker (music, logos, LUTs…). */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const el = document.createElement('input');
    el.type = 'file';
    el.accept = accept;
    el.multiple = multiple;
    el.style.display = 'none';
    el.onchange = () => { resolve(Array.from(el.files || [])); el.remove(); };
    document.body.appendChild(el);
    el.click();
  });
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Image as ImageIcon, X, Heart } from 'lucide-react';

interface Memory {
  id: string;
  image_url: string;
  created_at: string;
}

export default function App() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const init = async () => {
      try {
        const healthRes = await fetch('/api/health');
        const healthData = await healthRes.json();
        console.log('[App] Server health:', healthData);

        const memoriesRes = await fetch('/api/memories');
        if (memoriesRes.ok) {
          const data = await memoriesRes.json();
          setMemories(data);
        } else if (memoriesRes.status === 404) {
          const errorData = await memoriesRes.json();
          if (errorData.error === 'Table not found') {
            console.warn('[App] Database table "memories" is missing. Please run the setup SQL.');
          }
        }
      } catch (err) {
        console.error('[App] Initial fetch failed:', err);
      }
    };
    init();
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    const formData = new FormData();
    Array.from(files).forEach(file => {
      formData.append('images', file as Blob);
    });

    try {
      console.log('[App] Sending upload request to /api/upload');
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      const contentType = response.headers.get('content-type');
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Upload failed:', errorText);
        
        if (errorText.includes('Cookie check') || errorText.includes('Authenticate in new window')) {
          throw new Error('Security check required. Please click "Authenticate in new window" in the preview or open the app in a new tab.');
        }
        
        throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
      }

      if (contentType && contentType.includes('application/json')) {
        // Refresh memories from server to get real IDs and timestamps
        const memoriesRes = await fetch('/api/memories');
        if (memoriesRes.ok) {
          const data = await memoriesRes.json();
          setMemories(data);
        }
      } else {
        const text = await response.text();
        console.error('Unexpected response format:', text);
        
        if (text.includes('Cookie check') || text.includes('Authenticate in new window')) {
          throw new Error('Security check required. Please refresh the page or open the app in a new tab.');
        }
        
        throw new Error('Server returned non-JSON response');
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert(error instanceof Error ? error.message : 'Failed to upload images.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeImage = async (id: string) => {
    try {
      const response = await fetch(`/api/memories/${id}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setMemories(prev => prev.filter(m => m.id !== id));
      } else {
        throw new Error('Failed to delete memory from server');
      }
    } catch (error) {
      console.error('[App] Delete failed:', error);
      alert('Failed to delete memory. Please try again.');
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-between p-8 md:p-16 relative overflow-x-hidden">
      {/* Decoration Line */}
      <div className="absolute left-0 top-1/2 w-32 h-px bg-ink-theme opacity-10 hidden lg:block"></div>

      {/* Header */}
      <header className="flex justify-between items-start z-10">
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="font-serif text-2xl italic tracking-tight"
        >
          Memories Album
        </motion.div>
        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="text-[10px] md:text-xs uppercase tracking-[0.2em] opacity-60"
        >
          Vol. 01 — {memories.length} Entries
        </motion.div>
      </header>

      {/* Main Content */}
      <main className="flex-grow flex flex-col justify-center items-center text-center py-20 z-10">
        <motion.h1 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-serif text-5xl md:text-7xl font-normal leading-[1.1] mb-12 max-w-2xl"
        >
          Preserve a fleeting moment.
        </motion.h1>

        {/* Upload Trigger */}
        <div className="relative group">
          <input 
            type="file" 
            multiple 
            accept="image/*" 
            className="hidden" 
            ref={fileInputRef}
            onChange={handleUpload}
            disabled={isUploading}
          />
          <motion.button
            whileHover={{ scale: isUploading ? 1 : 1.05 }}
            whileTap={{ scale: isUploading ? 1 : 0.95 }}
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className={`relative w-40 h-40 md:w-48 md:h-48 border border-ink-theme rounded-full flex items-center justify-center text-xs uppercase tracking-[0.3em] transition-all duration-300 ${isUploading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-ink-theme hover:text-bg-theme'}`}
          >
            <span>{isUploading ? 'Uploading...' : 'Upload'}</span>
          </motion.button>
          {/* Dashed Outer Ring */}
          <div className={`absolute -inset-3 border border-dashed border-ink-theme/20 rounded-full pointer-events-none transition-transform duration-500 ${isUploading ? 'animate-spin-slow' : 'group-hover:scale-110'}`}></div>
        </div>
      </main>

      {/* Album Grid (Visible when images exist) */}
      <AnimatePresence>
        {memories.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            className="w-full max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-12 mb-20"
          >
            {memories.map((memory, index) => (
              <motion.div
                key={memory.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="relative group"
              >
                <div className="aspect-[4/5] overflow-hidden bg-white border border-ink-theme/10">
                  <img 
                    src={memory.image_url} 
                    alt={`Memory ${index}`} 
                    className="w-full h-full object-cover transition-transform duration-[2s] group-hover:scale-105"
                    referrerPolicy="no-referrer"
                  />
                </div>
                
                {/* Overlay Controls */}
                <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => removeImage(memory.id)}
                    className="bg-bg-theme/90 text-ink-theme p-2 border border-ink-theme/20 hover:bg-ink-theme hover:text-bg-theme transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>

                <div className="mt-4 flex justify-between items-baseline">
                  <span className="font-serif italic text-xs opacity-60">
                    {new Date(memory.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                  <span className="text-[10px] uppercase tracking-widest opacity-40">
                    #{String(memories.length - index).padStart(3, '0')}
                  </span>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="flex justify-between items-end border-t border-ink-theme/10 pt-8 z-10">
        <div className="text-[10px] leading-relaxed max-w-[200px] text-accent-theme uppercase tracking-wider">
          Last addition: {memories.length > 0 ? new Date(memories[0].created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'None'}<br />
          Archive Status: {memories.length > 0 ? 'Active' : 'Empty'}
        </div>
        <div className="font-serif italic text-sm opacity-60">
          {memories.length > 0 ? 'Scroll to explore' : 'Select an image to begin'}
        </div>
      </footer>
    </div>
  );
}


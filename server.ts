import express from 'express';
import { createServer as createViteServer } from 'vite';
import multer_ from 'multer';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const multer = (multer_ as any).default || multer_;

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function ensureBucketExists() {
  const bucketName = process.env.SUPABASE_S3_BUCKET || 'uploads';
  console.log(`[Server] Checking if bucket "${bucketName}" exists...`);
  
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  
  if (listError) {
    console.error('[Server] Error listing buckets:', listError.message);
    return;
  }

  const exists = buckets.some(b => b.id === bucketName);
  
  if (!exists) {
    console.log(`[Server] Bucket "${bucketName}" not found. Creating it...`);
    const { error: createError } = await supabase.storage.createBucket(bucketName, {
      public: true,
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
      fileSizeLimit: 5242880
    });
    
    if (createError) {
      console.error('[Server] Error creating bucket:', createError.message);
    } else {
      console.log(`[Server] Bucket "${bucketName}" created successfully.`);
    }
  } else {
    console.log(`[Server] Bucket "${bucketName}" already exists.`);
  }
}

console.log('[Server] Starting server.ts...');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function createServer() {
  await ensureBucketExists();
  const app = express();
  const PORT = 3000;

  // Request Logging
  app.use((req, res, next) => {
    console.log(`[Server] ${req.method} ${req.url}`);
    next();
  });

  // Health Check
  app.get('/api/health', async (req, res) => {
    let tableExists = false;
    try {
      const { data, error } = await supabase.from('memories').select('id').limit(1);
      tableExists = !error;
    } catch (e) {
      tableExists = false;
    }

    res.json({ 
      status: 'ok', 
      message: 'Server is running',
      db: {
        memoriesTableExists: tableExists
      },
      env: {
        SUPABASE_URL: !!process.env.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        SUPABASE_S3_ENDPOINT: !!process.env.SUPABASE_S3_ENDPOINT,
        SUPABASE_S3_ACCESS_KEY_ID: !!process.env.SUPABASE_S3_ACCESS_KEY_ID,
        SUPABASE_S3_SECRET_ACCESS_KEY: !!process.env.SUPABASE_S3_SECRET_ACCESS_KEY,
        NODE_ENV: process.env.NODE_ENV
      }
    });
  });

  app.post('/api/echo', express.json(), (req, res) => {
    res.json({ received: req.body });
  });

  // S3 Client Setup
  const s3Client = new S3Client({
    endpoint: process.env.SUPABASE_S3_ENDPOINT,
    region: process.env.SUPABASE_S3_REGION,
    credentials: {
      accessKeyId: process.env.SUPABASE_S3_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.SUPABASE_S3_SECRET_ACCESS_KEY || '',
    },
    forcePathStyle: true,
  });

  // Multer Setup (Memory Storage)
  const storage = (multer as any).memoryStorage ? (multer as any).memoryStorage() : (multer_ as any).memoryStorage();
  const upload = multer({ storage });

  // API Routes
  app.post('/api/upload', upload.array('images'), async (req, res) => {
    console.log('[Server] Upload route hit');
    try {
      const files = req.files as Express.Multer.File[];
      console.log(`[Server] Received ${files?.length || 0} files`);
      if (!files || files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
      }

      const uploadPromises = files.map(async (file) => {
        const fileExt = path.extname(file.originalname);
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}${fileExt}`;
        const bucket = process.env.SUPABASE_S3_BUCKET || 'uploads';

        console.log(`[Server] Attempting upload to bucket: "${bucket}", key: "${fileName}"`);

        const command = new PutObjectCommand({
          Bucket: bucket,
          Key: fileName,
          Body: file.buffer,
          ContentType: file.mimetype,
        });

        try {
          await s3Client.send(command);
          console.log(`[Server] Successfully uploaded ${fileName} to ${bucket}`);
        } catch (s3Error: any) {
          console.error(`[Server] S3 Send Error for ${fileName}:`, s3Error.name, s3Error.message);
          throw s3Error;
        }

        // Construct the public URL
        const endpoint = process.env.SUPABASE_S3_ENDPOINT;
        const supabaseUrl = process.env.SUPABASE_URL;
        
        let projectId = '';
        if (supabaseUrl) {
          try {
            projectId = new URL(supabaseUrl).hostname.split('.')[0];
          } catch (e) {
            console.error('[Server] Failed to parse SUPABASE_URL:', e);
          }
        }
        
        if (!projectId && endpoint) {
          try {
            const url = endpoint.includes('://') ? endpoint : `https://${endpoint}`;
            projectId = new URL(url).hostname.split('.')[0];
          } catch (e) {
            console.error('[Server] Failed to parse SUPABASE_S3_ENDPOINT:', e);
          }
        }

        if (!projectId) {
          throw new Error('Could not determine Supabase Project ID. Please check SUPABASE_URL or SUPABASE_S3_ENDPOINT.');
        }
        
        const publicUrl = `https://${projectId}.supabase.co/storage/v1/object/public/${bucket}/${fileName}`;
        console.log(`[Server] Generated public URL: ${publicUrl}`);

        return publicUrl;
      });

      const urls = await Promise.all(uploadPromises);

      // Persist to Supabase Database
      const { error: dbError } = await supabase
        .from('memories')
        .insert(urls.map(url => ({ image_url: url })));

      if (dbError) {
        console.error('[Server] Database insertion error:', dbError.message, dbError.details, dbError.hint);
        if (dbError.message.includes('relation "public.memories" does not exist')) {
          console.error('[Server] CRITICAL: The "memories" table does not exist in your Supabase database. Please run the SQL provided to create it.');
        }
        // We still return the URLs because the upload succeeded, 
        // but the user should know persistence failed.
      }

      res.json({ urls });
    } catch (error: any) {
      console.error('[Server] Upload error:', error);
      res.status(500).json({ 
        error: 'Upload failed', 
        message: error.message || String(error),
        details: error.name || 'UnknownError',
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });

  // Fetch all memories
  app.get('/api/memories', async (req, res) => {
    console.log('[Server] Fetching memories...');
    try {
      const { data, error } = await supabase
        .from('memories')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[Server] Supabase Fetch Error:', error.message, error.details, error.hint);
        if (error.message.includes('relation "public.memories" does not exist')) {
          return res.status(404).json({ 
            error: 'Table not found', 
            message: 'The "memories" table does not exist. Please run the setup SQL in your Supabase dashboard.' 
          });
        }
        throw error;
      }
      res.json(data || []);
    } catch (error: any) {
      console.error('[Server] Fetch error:', error.message || error);
      res.status(500).json({ error: 'Failed to fetch memories', details: error.message || String(error) });
    }
  });

  // Delete a memory
  app.delete('/api/memories/:id', async (req, res) => {
    const { id } = req.params;
    console.log(`[Server] Deleting memory: ${id}`);
    try {
      const { error } = await supabase
        .from('memories')
        .delete()
        .eq('id', id);

      if (error) throw error;
      res.json({ success: true });
    } catch (error) {
      console.error('[Server] Delete error:', error);
      res.status(500).json({ error: 'Failed to delete memory' });
    }
  });

  // Dedicated API 404 handler to prevent HTML fallback for API requests
  app.all('/api/*', (req, res) => {
    console.log(`[Server] API 404: ${req.method} ${req.url}`);
    res.status(404).json({ error: 'API route not found', method: req.method, path: req.url });
  });

  // Global Error Handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('[Server] Global Error:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  });

  // Vite Middleware for Development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });
    app.use(vite.middlewares);

    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      console.log(`[Server] Fallback hit for: ${req.method} ${url}`);
      try {
        let template = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}

if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  createServer().then(app => {
    app.listen(3000, '0.0.0.0', () => {
      console.log('Server running on http://localhost:3000');
    });
  });
}

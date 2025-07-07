// ffmpeg_webhook_server/index.js (async update)
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');
const cors = require('cors');
const app = express();

app.use(express.json());
app.use(cors());

const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const OUTPUT_DIR = path.join(__dirname, 'output');

if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR);
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

async function downloadFile(url, dest) {
  const writer = fs.createWriteStream(dest);
  const response = await axios({ method: 'GET', url, responseType: 'stream' });
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

app.post('/render', async (req, res) => {
  const { intro, bg, stories, ambient } = req.body;

  const timestamp = Date.now();
  const jobId = `job_${timestamp}`;
  const jobDir = path.join(DOWNLOADS_DIR, jobId);
  const videoOut = path.join(OUTPUT_DIR, `${jobId}.mp4`);
  const videoUrl = `${req.protocol}://${req.get('host')}/output/${jobId}.mp4`;

  try {
    fs.mkdirSync(jobDir);
    res.json({ status: 'processing', jobId, videoUrl });

    const inputPaths = [];
    const introPath = path.join(jobDir, 'intro.mp4');
    await downloadFile(intro, introPath);
    inputPaths.push(introPath);

    for (let i = 0; i < stories.length; i++) {
      const audioURL = stories[i];
      const audioPath = path.join(jobDir, `story${i + 1}.mp3`);
      await downloadFile(audioURL, audioPath);
      const imagePath = path.join(jobDir, 'bg.jpg');
      if (!fs.existsSync(imagePath)) await downloadFile(bg, imagePath);
      const storyOut = path.join(jobDir, `story${i + 1}.mp4`);
      const ffmpegCmd = `ffmpeg -loop 1 -y -i "${imagePath}" -i "${audioPath}" -c:v libx264 -tune stillimage -c:a aac -b:a 192k -shortest "${storyOut}"`;
      await new Promise((resolve, reject) => {
        exec(ffmpegCmd, (error) => {
          if (error) return reject(error);
          inputPaths.push(storyOut);
          resolve();
        });
      });
    }

    const ambientPath = path.join(jobDir, 'ambient.mp3');
    await downloadFile(ambient, ambientPath);
    const ambientVid = path.join(jobDir, 'ambient.mp4');
    const ambientCmd = `ffmpeg -loop 1 -y -i "${jobDir}/bg.jpg" -i "${ambientPath}" -c:v libx264 -tune stillimage -c:a aac -b:a 192k -shortest "${ambientVid}"`;
    await new Promise((resolve, reject) => {
      exec(ambientCmd, (error) => {
        if (error) return reject(error);
        inputPaths.push(ambientVid);
        resolve();
      });
    });

    const concatListPath = path.join(jobDir, 'concat.txt');
    fs.writeFileSync(concatListPath, inputPaths.map(p => `file '${p}'`).join('\n'));
    const concatCmd = `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c copy "${videoOut}"`;
    await new Promise((resolve, reject) => {
      exec(concatCmd, (error) => {
        if (error) return reject(error);
        resolve();
      });
    });

  } catch (err) {
    console.error('Async processing failed:', err);
  }
});

app.use('/output', express.static(OUTPUT_DIR));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

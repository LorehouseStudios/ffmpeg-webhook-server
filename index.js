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

// Ensure folders exist
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
  const { intro, bg, stories, ambient, outro } = req.body;

  try {
    const timestamp = Date.now();
    const jobDir = path.join(DOWNLOADS_DIR, `${timestamp}`);
    fs.mkdirSync(jobDir);

    const inputPaths = [];

    // Download intro
    const introPath = path.join(jobDir, 'intro.mp4');
    await downloadFile(intro, introPath);
    inputPaths.push(introPath);

    // Download and combine each story with static image
    for (let i = 0; i < stories.length; i++) {
      const audioURL = stories[i];
      const audioPath = path.join(jobDir, `story${i + 1}.mp3`);
      await downloadFile(audioURL, audioPath);

      const imagePath = path.join(jobDir, `bg.jpg`);
      if (!fs.existsSync(imagePath)) await downloadFile(bg, imagePath);

      const storyOut = path.join(jobDir, `story${i + 1}.mp4`);
      const ffmpegCmd = `ffmpeg -loop 1 -y -i "${imagePath}" -i "${audioPath}" -c:v libx264 -tune stillimage -c:a aac -b:a 192k -shortest "${storyOut}"`;

      await new Promise((resolve, reject) => {
        exec(ffmpegCmd, (error, stdout, stderr) => {
          if (error) return reject(error);
          inputPaths.push(storyOut);
          resolve();
        });
      });
    }

    // Download ambient and outro
    const ambientPath = path.join(jobDir, 'ambient.mp3');
    await downloadFile(ambient, ambientPath);
    const ambientVid = path.join(jobDir, 'ambient.mp4');
    const bgImagePath = path.join(jobDir, 'bg.jpg');
    const ambientCmd = `ffmpeg -loop 1 -y -i "${bgImagePath}" -i "${ambientPath}" -c:v libx264 -tune stillimage -c:a aac -b:a 192k -shortest "${ambientVid}"`;
    await new Promise((resolve, reject) => {
      exec(ambientCmd, (error, stdout, stderr) => {
        if (error) return reject(error);
        inputPaths.push(ambientVid);
        resolve();
      });
    });

    const outroPath = path.join(jobDir, 'outro.mp4');
    await downloadFile(outro, outroPath);
    inputPaths.push(outroPath);

    // Create concat list file
    const concatListPath = path.join(jobDir, 'concat.txt');
    fs.writeFileSync(concatListPath, inputPaths.map(p => `file '${p}'`).join('\n'));

    const finalOut = path.join(OUTPUT_DIR, `final_${timestamp}.mp4`);
    const concatCmd = `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c copy "${finalOut}"`;
    await new Promise((resolve, reject) => {
      exec(concatCmd, (error, stdout, stderr) => {
        if (error) return reject(error);
        resolve();
      });
    });

    res.download(finalOut);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to compile video.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

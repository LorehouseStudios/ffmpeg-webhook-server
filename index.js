const express = require('express');
const fs = require('fs');
const { exec } = require('child_process');
const app = express();
const port = 10000;

app.use(express.json());

app.post('/render', (req, res) => {
  const jobId = `job_${Date.now()}`;
  const outputPath = `./output/${jobId}.mp4`;

  console.log(`📨 Received render request. jobId: ${jobId}`);

  const command

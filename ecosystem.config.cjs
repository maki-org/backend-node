module.exports = {
  apps: [{
    name: 'maki-backend',
    script: 'src/server.js',
    instances: 1,  // Single instance for t3.micro (1 vCPU)
    exec_mode: 'fork',  // Fork mode (not cluster) for t3.micro
    autorestart: true,
    watch: false,
    max_memory_restart: '800M',  // Restart if memory exceeds 800MB
    env: {
      NODE_ENV: 'production',
      PORT: 8000
    },
    error_file: 'logs/pm2-error.log',
    out_file: 'logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    time: true
  }]
};
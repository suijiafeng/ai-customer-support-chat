import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'suijiafeng2@gmail.com',       // 你的 Gmail
    pass: 'tvet ckyd jttz ljuk',  // 刚才生成的 16 位 App Password
  },
});

async function sendMail() {
  await transporter.sendMail({
    from: 'hi@suijf.site',
    to: '1022250508@qq.com',
    subject: '测试邮件',
    text: '这是一封自动发送的邮件',
  });
  console.log('发送成功');
}

sendMail();
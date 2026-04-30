const FormData = require('form-data');
const axios = require('axios');

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_IMAGES_TOKEN = process.env.CLOUDFLARE_IMAGES_TOKEN;
const CLOUDFLARE_ACCOUNT_HASH = process.env.CLOUDFLARE_ACCOUNT_HASH; // optional

exports.uploadImage = async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_IMAGES_TOKEN) {
      console.error('Cloudflare configuration missing. CLOUDFLARE_ACCOUNT_ID present:', !!CLOUDFLARE_ACCOUNT_ID);
      return res.status(500).json({ success: false, error: 'Cloudflare configuration missing' });
    }

    const form = new FormData();
    // Append buffer as file
    form.append('file', req.file.buffer, {
      filename: req.file.originalname || 'upload',
      contentType: req.file.mimetype || 'application/octet-stream',
    });

    const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/images/v1`;

    const response = await axios.post(url, form, {
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_IMAGES_TOKEN}`,
        ...form.getHeaders(),
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    const data = response.data;

    if (!data || !data.success) {
      return res.status(502).json({ success: false, error: (data && data.errors && data.errors[0] && data.errors[0].message) || 'Cloudflare error' });
    }

    const result = data.result;

    // Prefer returned variant url
    let publicUrl = '';
    if (result && Array.isArray(result.variants) && result.variants.length > 0) {
      publicUrl = result.variants[0];
    } else if (result && result.id && CLOUDFLARE_ACCOUNT_HASH) {
      publicUrl = `https://imagedelivery.net/${CLOUDFLARE_ACCOUNT_HASH}/${result.id}/public`;
    }

    return res.json({ success: true, url: publicUrl, id: result.id, result });
  } catch (err) {
    const respData = err && err.response && err.response.data;
    console.error('Upload to Cloudflare failed:', respData || err.message || err);
    const cloudMsg = respData && respData.errors && respData.errors[0] && respData.errors[0].message;

    // If Cloudflare responds with 401/403, indicate authentication/permission issue
    if (err && err.response && [401, 403].includes(err.response.status)) {
      return res.status(401).json({ success: false, error: `Cloudflare authentication error${cloudMsg ? ': ' + cloudMsg : ''}` });
    }

    const msg = cloudMsg || err.message || 'Upload failed';
    return res.status(500).json({ success: false, error: msg });
  }
};

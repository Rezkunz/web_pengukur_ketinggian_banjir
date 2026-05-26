module.exports = async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const rssUrl = encodeURIComponent('https://news.google.com/rss/search?q=banjir+OR+%22cuaca+ekstrem%22+OR+%22banjir+bandung%22+OR+bmkg&hl=id&gl=ID&ceid=ID:id');
  const url = `https://api.rss2json.com/v1/api.json?rss_url=${rssUrl}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Rss2Json returned status ${response.status}`);
    }
    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('Proxy news error:', error);
    return res.status(500).json({ error: error.message });
  }
};

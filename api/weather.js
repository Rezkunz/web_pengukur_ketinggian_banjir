module.exports = async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { latitude, longitude } = req.query;
  if (!latitude || !longitude) {
    return res.status(400).json({ error: 'Missing latitude or longitude' });
  }

  const rawUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&hourly=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&wind_speed_unit=ms&timezone=Asia%2FJakarta`;
  
  const proxy1 = `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(rawUrl)}`;
  const proxy2 = `https://api.allorigins.win/raw?url=${encodeURIComponent(rawUrl)}`;

  try {
    let response = await fetch(proxy1);
    if (!response.ok) {
        response = await fetch(proxy2);
    }
    if (!response.ok) {
        throw new Error(`Proxies returned error: ${response.status}`);
    }
    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('Proxy weather error:', error);
    return res.status(500).json({ error: error.message });
  }
};

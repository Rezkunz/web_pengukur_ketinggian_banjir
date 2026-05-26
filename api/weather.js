module.exports = async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { latitude, longitude, allowBmkg } = req.query;
  if (!latitude || !longitude) {
    return res.status(400).json({ error: 'Missing latitude or longitude' });
  }

  const rawUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&hourly=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=7&wind_speed_unit=ms&timezone=Asia%2FJakarta`;
  const proxy1 = `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(rawUrl)}`;
  const proxy2 = `https://api.allorigins.win/raw?url=${encodeURIComponent(rawUrl)}`;
  const bmkgUrl = 'https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=32.04.08.2005';
  const sevenTimerUrl = `https://www.7timer.info/bin/api.pl?lon=${longitude}&lat=${latitude}&product=civil&output=json`;
  const wttrUrl = `https://wttr.in/${latitude},${longitude}?format=j1`;

  async function tryJson(url, timeout = 2500) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      console.warn(`Weather provider failed: ${url}`, error);
      return null;
    } finally {
      clearTimeout(id);
    }
  }

  try {
    let data = await tryJson(rawUrl);
    if (data) return res.status(200).json(data);

    if (allowBmkg === '1') {
      data = await tryJson(bmkgUrl, 8000);
      if (data) {
        data.source = 'bmkg';
        return res.status(200).json(data);
      }
    }

    data = await tryJson(sevenTimerUrl, 10000);
    if (data?.dataseries) {
      data.source = '7timer';
      return res.status(200).json(data);
    }

    data = await tryJson(proxy1);
    if (data) return res.status(200).json(data);

    data = await tryJson(proxy2);
    if (data) return res.status(200).json(data);

    data = await tryJson(wttrUrl, 5000);
    if (data) return res.status(200).json(data);

    throw new Error('All weather providers failed');
  } catch (error) {
    console.error('Proxy weather error:', error);
    return res.status(500).json({ error: error.message });
  }
};

export default async function handler(req, res) {
  const { name, city } = req.query;

  const apiKey = process.env.SERPAPI_KEY;

  if (!name || !city) {
    return res.status(400).json({ error: "Missing name or city" });
  }

  try {
    const response = await fetch(
      `https://serpapi.com/search.json?engine=google_maps&q=${encodeURIComponent(name + " " + city)}&type=search&api_key=${apiKey}`
    );

    const data = await response.json();

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: "API failed" });
  }
}

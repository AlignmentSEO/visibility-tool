export default async function handler(req, res) {
  const { name, city } = req.query;

  const apiKey = process.env.SERPAPI_KEY;

  try {
    const response = await fetch(
      `https://serpapi.com/search.json?engine=google_maps&q=${name} ${city}&type=search&api_key=${apiKey}`
    );

    const data = await response.json();

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: "API failed" });
  }
}

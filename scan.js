{\rtf1\ansi\ansicpg1252\cocoartf2822
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\pard\tx720\tx1440\tx2160\tx2880\tx3600\tx4320\tx5040\tx5760\tx6480\tx7200\tx7920\tx8640\pardirnatural\partightenfactor0

\f0\fs24 \cf0 export default async function handler(req, res) \{\
  const \{ name, city \} = req.query;\
\
  const apiKey = process.env.SERPAPI_KEY;\
\
  try \{\
    const response = await fetch(\
      `https://serpapi.com/search.json?engine=google_maps&q=$\{name\} $\{city\}&type=search&api_key=$\{apiKey\}`\
    );\
\
    const data = await response.json();\
\
    res.status(200).json(data);\
  \} catch (error) \{\
    res.status(500).json(\{ error: "API failed" \});\
  \}\
\}}
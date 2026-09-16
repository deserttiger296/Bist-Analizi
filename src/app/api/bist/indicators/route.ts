import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // stocksharp-service runs on http://localhost:5007 locally
    // In production, you would configure an environment variable for the stocksharp-service URL.
    const STOCKSHARP_URL = process.env.STOCKSHARP_URL || 'http://localhost:5007';

    const response = await fetch(`${STOCKSHARP_URL}/api/indicators/calculate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `StockSharp service error: ${response.status} ${response.statusText}`, details: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Error proxying to stocksharp-service:', error);
    return NextResponse.json(
      { error: 'Failed to proxy request to stocksharp-service', message: error.message },
      { status: 500 }
    );
  }
}

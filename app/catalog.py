from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DestinationMeta:
    code: str
    city: str
    country: str
    region: str
    baseline_cash: float
    baseline_awards: dict[str, int]


DESTINATIONS: tuple[DestinationMeta, ...] = (
    DestinationMeta("ATL", "Atlanta", "United States", "domestic", 220, {"economy": 11000, "business": 26000, "first": 34000}),
    DestinationMeta("BOS", "Boston", "United States", "domestic", 240, {"economy": 13000, "business": 32000, "first": 42000}),
    DestinationMeta("DCA", "Washington, DC", "United States", "domestic", 210, {"economy": 11000, "business": 25000, "first": 34000}),
    DestinationMeta("DEN", "Denver", "United States", "domestic", 180, {"economy": 9000, "business": 22000, "first": 30000}),
    DestinationMeta("DFW", "Dallas", "United States", "domestic", 150, {"economy": 7500, "business": 18000, "first": 26000}),
    DestinationMeta("EWR", "Newark", "United States", "domestic", 225, {"economy": 11500, "business": 28000, "first": 36000}),
    DestinationMeta("JFK", "New York", "United States", "domestic", 235, {"economy": 12000, "business": 30000, "first": 38000}),
    DestinationMeta("LAS", "Las Vegas", "United States", "domestic", 165, {"economy": 8500, "business": 21000, "first": 28000}),
    DestinationMeta("LAX", "Los Angeles", "United States", "domestic", 175, {"economy": 9000, "business": 22000, "first": 30000}),
    DestinationMeta("MCO", "Orlando", "United States", "domestic", 215, {"economy": 11000, "business": 26000, "first": 34000}),
    DestinationMeta("MIA", "Miami", "United States", "domestic", 230, {"economy": 11500, "business": 28000, "first": 36000}),
    DestinationMeta("MSP", "Minneapolis", "United States", "domestic", 205, {"economy": 10500, "business": 25000, "first": 33000}),
    DestinationMeta("ORD", "Chicago", "United States", "domestic", 190, {"economy": 9500, "business": 23000, "first": 31000}),
    DestinationMeta("PHL", "Philadelphia", "United States", "domestic", 225, {"economy": 11500, "business": 28000, "first": 36000}),
    DestinationMeta("SEA", "Seattle", "United States", "domestic", 210, {"economy": 11000, "business": 26000, "first": 34000}),
    DestinationMeta("SFO", "San Francisco", "United States", "domestic", 190, {"economy": 10000, "business": 24000, "first": 32000}),
    DestinationMeta("SLC", "Salt Lake City", "United States", "domestic", 180, {"economy": 9000, "business": 22000, "first": 30000}),
    DestinationMeta("YYZ", "Toronto", "Canada", "international", 290, {"economy": 13000, "business": 32000, "first": 45000}),
    DestinationMeta("YVR", "Vancouver", "Canada", "international", 315, {"economy": 14000, "business": 35000, "first": 48000}),
    DestinationMeta("CUN", "Cancun", "Mexico", "international", 260, {"economy": 12000, "business": 30000, "first": 42000}),
    DestinationMeta("MEX", "Mexico City", "Mexico", "international", 280, {"economy": 13000, "business": 32000, "first": 44000}),
    DestinationMeta("LHR", "London", "United Kingdom", "international", 690, {"economy": 26000, "business": 52000, "first": 82000}),
    DestinationMeta("CDG", "Paris", "France", "international", 700, {"economy": 27000, "business": 54000, "first": 84000}),
    DestinationMeta("AMS", "Amsterdam", "Netherlands", "international", 705, {"economy": 27000, "business": 54000, "first": 82000}),
    DestinationMeta("FRA", "Frankfurt", "Germany", "international", 710, {"economy": 28000, "business": 56000, "first": 86000}),
    DestinationMeta("MAD", "Madrid", "Spain", "international", 675, {"economy": 25000, "business": 50000, "first": 78000}),
    DestinationMeta("BCN", "Barcelona", "Spain", "international", 685, {"economy": 26000, "business": 52000, "first": 80000}),
    DestinationMeta("LIS", "Lisbon", "Portugal", "international", 650, {"economy": 24000, "business": 49000, "first": 76000}),
    DestinationMeta("FCO", "Rome", "Italy", "international", 705, {"economy": 28000, "business": 56000, "first": 84000}),
    DestinationMeta("ICN", "Seoul", "South Korea", "international", 950, {"economy": 38000, "business": 85000, "first": 120000}),
    DestinationMeta("HND", "Tokyo", "Japan", "international", 980, {"economy": 40000, "business": 90000, "first": 125000}),
    DestinationMeta("NRT", "Tokyo", "Japan", "international", 960, {"economy": 40000, "business": 90000, "first": 125000}),
    DestinationMeta("SIN", "Singapore", "Singapore", "international", 1090, {"economy": 45000, "business": 95000, "first": 135000}),
    DestinationMeta("DXB", "Dubai", "United Arab Emirates", "international", 930, {"economy": 36000, "business": 85000, "first": 125000}),
)


PARTNER_PROGRAMS: dict[str, dict[str, object]] = {
    "aeroplan": {"name": "Air Canada Aeroplan", "banks": ["amex", "capital_one"]},
    "avianca": {"name": "Avianca LifeMiles", "banks": ["capital_one"]},
    "britishairways": {"name": "British Airways Executive Club", "banks": ["amex", "capital_one"]},
    "cathay": {"name": "Cathay", "banks": ["amex", "capital_one"]},
    "delta": {"name": "Delta SkyMiles", "banks": ["amex"]},
    "emirates": {"name": "Emirates Skywards", "banks": ["amex", "capital_one"]},
    "etihad": {"name": "Etihad Guest", "banks": ["amex", "capital_one"]},
    "flyingblue": {"name": "Flying Blue", "banks": ["amex", "capital_one"]},
    "hawaiian": {"name": "HawaiianMiles", "banks": ["amex"]},
    "iberia": {"name": "Iberia Plus", "banks": ["amex", "capital_one"]},
    "jetblue": {"name": "JetBlue TrueBlue", "banks": ["amex", "capital_one"]},
    "qantas": {"name": "Qantas Frequent Flyer", "banks": ["amex", "capital_one"]},
    "singapore": {"name": "Singapore KrisFlyer", "banks": ["amex", "capital_one"]},
    "tap": {"name": "TAP Miles&Go", "banks": ["capital_one"]},
    "turkish": {"name": "Turkish Miles&Smiles", "banks": ["capital_one"]},
    "virginatlantic": {"name": "Virgin Atlantic Flying Club", "banks": ["amex", "capital_one"]},
}


AIRPORT_COORDINATES: dict[str, tuple[float, float]] = {
    "AUS": (30.1945, -97.6699),
    "ATL": (33.6407, -84.4277),
    "BOS": (42.3656, -71.0096),
    "DCA": (38.8512, -77.0402),
    "DEN": (39.8561, -104.6737),
    "DFW": (32.8998, -97.0403),
    "EWR": (40.6895, -74.1745),
    "JFK": (40.6413, -73.7781),
    "LAS": (36.0840, -115.1537),
    "LAX": (33.9416, -118.4085),
    "MCO": (28.4312, -81.3081),
    "MIA": (25.7959, -80.2870),
    "MSP": (44.8848, -93.2223),
    "ORD": (41.9742, -87.9073),
    "PHL": (39.8744, -75.2424),
    "SEA": (47.4502, -122.3088),
    "SFO": (37.6213, -122.3790),
    "SLC": (40.7899, -111.9791),
    "YYZ": (43.6777, -79.6248),
    "YVR": (49.1967, -123.1815),
    "CUN": (21.0365, -86.8771),
    "MEX": (19.4361, -99.0719),
    "LHR": (51.4700, -0.4543),
    "CDG": (49.0097, 2.5479),
    "AMS": (52.3105, 4.7683),
    "FRA": (50.0379, 8.5622),
    "MAD": (40.4983, -3.5676),
    "BCN": (41.2974, 2.0833),
    "LIS": (38.7742, -9.1342),
    "FCO": (41.8003, 12.2389),
    "ICN": (37.4602, 126.4407),
    "HND": (35.5494, 139.7798),
    "NRT": (35.7719, 140.3929),
    "SIN": (1.3644, 103.9915),
    "DXB": (25.2532, 55.3657),
}


def destination_lookup() -> dict[str, DestinationMeta]:
    return {item.code: item for item in DESTINATIONS}


def airport_coordinates(code: str) -> tuple[float, float] | None:
    return AIRPORT_COORDINATES.get(code.upper())

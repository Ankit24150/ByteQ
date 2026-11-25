"""Category / emoji mapping for menu items (the dataset only has name + price)."""
import re

CATEGORY = {
    "Samosa": "Snacks", "Poha": "Snacks", "French Fries": "Snacks", "Veg Momos": "Snacks",
    "Veg Sandwich": "Fast Food", "Cheese Sandwich": "Fast Food", "Masala Maggi": "Fast Food",
    "Paneer Roll": "Fast Food", "Veg Burger": "Fast Food",
    "Aloo Paratha": "Meals", "Idli Sambhar": "Meals", "Chole Kulche": "Meals",
    "Pav Bhaji": "Meals", "Dosa": "Meals",
    "Cold Coffee": "Beverages", "Tea": "Beverages", "Lemonade": "Beverages",
    "Chocolate Shake": "Beverages",
}
EMOJI = {
    "Samosa": ("🥟", "#fde68a", "#f59e0b"), "Poha": ("🍚", "#fef3c7", "#fbbf24"),
    "French Fries": ("🍟", "#fee2e2", "#f87171"), "Veg Momos": ("🥟", "#e0e7ff", "#818cf8"),
    "Veg Sandwich": ("🥪", "#dcfce7", "#4ade80"), "Cheese Sandwich": ("🧀", "#fef9c3", "#facc15"),
    "Masala Maggi": ("🍜", "#ffedd5", "#fb923c"), "Paneer Roll": ("🌯", "#fae8ff", "#e879f9"),
    "Veg Burger": ("🍔", "#fecaca", "#ef4444"), "Aloo Paratha": ("🫓", "#fef3c7", "#d97706"),
    "Idli Sambhar": ("🍥", "#f1f5f9", "#94a3b8"), "Chole Kulche": ("🍛", "#ffedd5", "#ea580c"),
    "Pav Bhaji": ("🍞", "#fee2e2", "#dc2626"), "Dosa": ("🥞", "#fef3c7", "#f59e0b"),
    "Cold Coffee": ("🧋", "#e7e5e4", "#a8a29e"), "Tea": ("🍵", "#d1fae5", "#34d399"),
    "Lemonade": ("🍋", "#fef9c3", "#eab308"), "Chocolate Shake": ("🥤", "#f5d0c5", "#a16207"),
}


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def category_for(name: str) -> str:
    return CATEGORY.get(name, "Snacks")


def svg_for(name: str) -> str:
    emoji, c1, c2 = EMOJI.get(name, ("🍽️", "#e5e7eb", "#9ca3af"))
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">'
        f'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{c1}"/>'
        f'<stop offset="1" stop-color="{c2}"/></linearGradient></defs>'
        '<rect width="400" height="300" fill="url(#g)"/>'
        '<circle cx="330" cy="50" r="90" fill="#fff" opacity=".25"/>'
        '<circle cx="60" cy="270" r="70" fill="#fff" opacity=".2"/>'
        f'<text x="200" y="185" font-size="130" text-anchor="middle">{emoji}</text></svg>'
    )

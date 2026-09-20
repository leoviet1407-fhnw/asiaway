# Drinks allergen review — NEEDS RESTAURANT SIGN-OFF

The drinks CSV originally had no allergen column. The codes below were
**derived from what each product is**, not supplied by the restaurant, and
every one needs confirming before guests rely on it.

Allergen information is a legal declaration. Nothing here was guessed from a
product name alone: where the answer genuinely depends on the producer or the
house recipe, the cell was left blank and the app tells the guest it is not
declared rather than implying the drink is free of allergens.

Codes: **A** gluten · **G** milk · **O** sulfites (full legend in the app).

## 1. Derived — please confirm or correct

| ✓ | Drink | Code | Why |
|---|---|---|---|
| ☐ | Aperol Spritz | **O** | Grape-wine based — sulfite declaration is standard for wine. |
| ☐ | Hugo | **O** | Grape-wine based — sulfite declaration is standard for wine. |
| ☐ | Lillet | **O** | Grape-wine based — sulfite declaration is standard for wine. |
| ☐ | Gespritzter Weisswein | **O** | Grape-wine based — sulfite declaration is standard for wine. |
| ☐ | Prosecco | **O** | Grape-wine based — sulfite declaration is standard for wine. |
| ☐ | Thai Red Milk Tea | **G** | Milk is named in the drink or is part of its definition. |
| ☐ | Saigon (Vietnam) | **A** | Beer is a barley product. |
| ☐ | Kirin (Japan) | **A** | Beer is a barley product. |
| ☐ | Tsingtao (China) | **A** | Beer is a barley product. |
| ☐ | Chang (Thailand) | **A** | Beer is a barley product. |
| ☐ | Singha (Thailand) | **A** | Beer is a barley product. |
| ☐ | Feldschlösschen Alkoholfrei | **A** | Beer is a barley product. |
| ☐ | Cappuccino | **G** | Milk is named in the drink or is part of its definition. |
| ☐ | Latte Macchiato | **G** | Milk is named in the drink or is part of its definition. |
| ☐ | Espresso Macchiato | **G** | Milk is named in the drink or is part of its definition. |
| ☐ | Schale (mit warmer Milch) | **G** | Milk is named in the drink or is part of its definition. |

## 2. Deliberately left undeclared — please supply

These show *"Allergens not declared — please ask your waiter"* in the app today.

| ✓ | Drink | Why it was not filled in |
|---|---|---|
| ☐ | Mango Caipirinha | Depends on the base spirit and mango product used. |
| ☐ | Vietnamese Iced Tea | May be plain tea or served with condensed milk (G). Confirm the house recipe. |
| ☐ | Pure Coconut Water | Packaged juices sometimes carry sulfites (O). Check the carton. |
| ☐ | Mango Nectar | Packaged juices sometimes carry sulfites (O). Check the carton. |
| ☐ | Lycheesaft | Packaged juices sometimes carry sulfites (O). Check the carton. |
| ☐ | Guavasaft | Packaged juices sometimes carry sulfites (O). Check the carton. |
| ☐ | Sake (Japan) | Sulfites (O) vary by producer. Check the bottle. |
| ☐ | Pflaumenwein (Japan) | Sulfites (O) vary by producer. Check the bottle. |
| ☐ | Lycheewine (China) | Sulfites (O) vary by producer. Check the bottle. |
| ☐ | Soju Original (Korea) | Sulfites (O) vary by producer. Check the bottle. |
| ☐ | Soju Lychee (Korea) | Sulfites (O) vary by producer. Check the bottle. |
| ☐ | Café Crème | In Switzerland this is normally black coffee despite the name; confirm whether cream is served with it (G). |
| ☐ | Vietnamesischer Eiskaffee | Traditionally made with condensed milk (G), but can be served black. Confirm the house recipe. |
| ☐ | Vietnamesischer Heisskaffee (siehe Bild) | Traditionally made with condensed milk (G), but can be served black. Confirm the house recipe. |

## 3. No allergen expected

Waters, soft drinks, bottled teas and the homemade teas and spritzers. Still
shown as *not declared* until someone confirms them, because an empty cell
cannot be distinguished from an unanswered one.

Hibiscus Iced Tea, Lemongrass Iced Tea, Lychee Green Tea, Fresh Lime Soda, Raspberry Lime Spritzer, Mango Spritzer, Lychee Spritzer, Green Tea Original, Green Tea Honey Lemon, Black Tea Lemon, Green Tea No Sugar, Mineralwasser mit Kohlensäure, Mineralwasser ohne Kohlensäure, Coca Cola, Coca Cola Zero, Apfelschorle, Pink Grapefruit Soda, Yuzu Lime Lemonade, Espresso, Espresso Doppio.

## How to apply corrections

Edit the `Allergens` column in `data/asiaway_drinks_menu.csv` (space-separated
codes, e.g. `A G`), then re-import:

```bash
DATABASE_URL='<production url>' npm run menu:import
```

The importer rejects any code outside the printed legend, and re-importing
never resets a dish the waiter has marked sold out.

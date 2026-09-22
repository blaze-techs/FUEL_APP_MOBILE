import { isPlausibleStationPrice } from "../src/react-app/config/pricing";

const cases: Array<[number, string, string]> = [
  [1.42, "US", "Super Petrol"],
  [1.51, "US", "Diesel"],
  [217.86, "US", "Diesel"],
  [220.08, "US", "Super Petrol"],
  [1.42, "KE", "Super Petrol"],
  [214.03, "KE", "Super Petrol"],
  [217.86, "KE", "Diesel"],
];
for (const [p, c, f] of cases) {
  console.log(`${p} ${c} ${f} -> ${isPlausibleStationPrice(p, c, f)}`);
}

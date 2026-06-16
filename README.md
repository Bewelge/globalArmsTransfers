# globalArmsTransfers
An Interactive visualisation of global arms transfers from 1950 to 2017

---

## 2026 overhaul (built with AI-tools)

Project was substantially reworked with the help of AI-tools
The original 2017 version is preserved, unchanged, on the
[**`Original` branch**](https://github.com/Bewelge/globalArmsTransfers/tree/Original) 

This was updated:

### Dataset updated to 1950–2025

The SIPRI Arms Transfers data was re-fetched and rebuilt from the per-year trade-register
exports, extending coverage from 1950–2017 to **1950–2025**.

> Source: SIPRI Arms Transfers Database — <https://doi.org/10.55163/SAFC1241>

**New consolidations**

- **Modern spellings / historical entities:** Turkiye → Turkey, North Macedonia → Macedonia,
  United Arab Emirates → UAE, Czechia → Czech Republic, Bosnia-Herzegovina → Bosnia and
  Herzegovina, Cabo Verde → Cape Verde, eSwatini → Swaziland,
  Yemen Arab Republic (North Yemen) → North Yemen, Katanga → DR Congo, and unified
  Germany → Germany (FRG) (reusing the original FRG map shape/location key).
- **Additional non-state / faction groups → host country:** Darfur rebels / RSF / SPLA → Sudan;
  PLO / Hamas / Palestinian Islamic Jihad / PRC → Palestine; House of Representatives & NTC → Libya;
  EPLF → Ethiopia; FAN → Chad; MPLA → Angola; FRELIMO → Mozambique; PAIGC → Guinea-Bissau;
  Kurdistan Regional Government → Iraq; LRA → Uganda; MNLF → Philippines; United Wa State → Myanmar;
  NLA → Macedonia; Pathet Lao → Laos; PKK → Turkey; Provisional IRA → United Kingdom; RPF → Rwanda;
  RUF → Sierra Leone; Houthi & Southern rebels → Yemen.
- **Dropped entirely**  the African Union, European Union, NATO, OSCE,
  Regional Security System and United Nations, plus unknown supplier/recipient/rebel entries.

### Frontend ported to WebGL

The animation was rewritten from the original Canvas2D + jQuery + Spectrum stack into a
dependency-free WebGL-based version:

- **WebGL dot renderer** 
- **Full-screen, responsive map** 
- **draggable timeline**


---

_The original README follows, unchanged._

* Heavily inspired by Will Geary's (@wgeary) Video - https://vimeo.com/286751571


* SVG Map by AMCharts - https://www.amcharts.com/svg-maps/?map=world


* Dataset retrieved from SIPRI - https://www.sipri.org/databases/armstransfers
* Thanks to Jsvine for this neat trick to download the set as CSV - https://gist.github.com/jsvine/9cb3300588ed402160fe
* Cleaned dataset by removing:

	- All deals where Supplier or Recipient is unknown.
	- All deals which had multiple sellers without specification which. 
	- Deals with the UN, NATO, Regional Security System (RSSS), OSCE & African Union as seller or buyer

* and consolidating the following groups:
	- Amal (Lebanon)* -> Lebanon
	- ANC (South Africa)* -> South Africa
	- Anti-Castro rebels (Cuba)* -> Cuba
	- Armas (Guatemala) -> Guatemala
	- Biafra -> Nigeria
	- contras (Nicaragua)* -> Nicaragua
	- El Salvador (FMLN) -> El Salvador
	- ELF (Ethiopia)* -> Ethiopia
	- FNLA (Angola)* -> Angola
	- GUNT (Chad)* -> Chad
	- Haiti Rebels -> Haiti
	- Hezbollah (Lebanon)* -> Lebanon
	- Huthi rebels (Yemen)* -> Yemen
	- Indonesia Rebels -> Indonesia
	- Khmer Rouge (Cambodia)* -> Cambodia
	- Lebanon Palestinian rebels* -> Lebanon
	- LF (Lebanon)* -> Lebanon
	- libya GNC -> Libya
	- Libya HoR -> Libya
	- LTTE (Sri Lanka)* -> Sri Lanka
	- Macedonia (FYROM) -> Macedonia
	- MTA (Myanmar)* -> Myanmar
	- Mujahedin (Afghanistan)* -> Afghanistan
	- Northern Alliance (Afghanistan)* -> Afghanistan
	- Northern Cyprus -> Cyprus
	- SLA (Lebanon)* -> Lebanon
	- SNA (Somalia)* -> Somalia
	- Southern rebels (Yemen)* -> Yemen
	- Soviet Union -> Russia
	- Syria Rebels -> Syria
	- UIC (Somalia)* -> Somalia
	- Ukraine Rebels* -> Ukraine
	- UNITA (Angola)* -> Angola
	- Viet Cong -> Vietnam
	- Viet Minh -> Vietnam
	- Viet Nam -> Vietnam
	- ZAPU -> Zimbabwe


* Other plugins used: 
	- Color Picker - https://bgrins.github.io/spectrum/ by bgrins
	- jQuery 
*/

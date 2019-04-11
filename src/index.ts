//import * as firebase from 'firebase';
import * as functions from 'firebase-functions';
import * as geohash from 'ngeohash';
import * as admin from 'firebase-admin';
import { HTMLElement } from 'node-html-parser';
import { DocumentData } from '@google-cloud/firestore';
import * as geocode from '@google/maps';

// Start writing Firebase Functions
// https://firebase.google.com/docs/functions/typescript

// export const helloWorld = functions.https.onRequest((request, response) => {
//     response.send("Hello from Firebase!");
// });
//firebase.initializeApp(functions.config().firebase);
admin.initializeApp();
const firestore = admin.firestore();

export const onTeaShopCreate = functions.firestore
    .document("/tea_shops/{shopId}")
    .onCreate((snapshot, context) => {
        const data = snapshot.data();
        if (data === undefined) {
            return null;
        }
        let lat = data.t;
        if (typeof lat === "string") {
            lat = parseFloat(lat);
        }
        let lng = data.g;
        if (typeof lng === "string") {
            lng = parseFloat(lng);
        }
        const hash = geohash.encode(lat, lng);

        let branchName: string = data.branchName;
        if (branchName !== undefined && branchName.charAt(branchName.length - 1) === "店") {
            branchName = branchName.substring(0, branchName.length - 1);
        }

        let city = data.city;
        let district = data.district;
        let address = data.address;

        if (city === undefined && district === undefined) {
            const result = parseAddress(address);
            city = result[0];
            district = result[1];
            address = result[2];
        }
        return snapshot.ref.set({
            t: admin.firestore.FieldValue.delete(), g: admin.firestore.FieldValue.delete(),
            branchName: branchName, city: city, district: district, address: address,
            position: { geopoint: new admin.firestore.GeoPoint(lat, lng), geohash: hash }
        }, { merge: true })
            .catch((error) => {
                console.log(error);
            });
    });

export const deleteShopData = functions.https.onRequest(async (req, res) => {
    const shop = req.query["shop"];

    if (shop === undefined || shop === null) {
        res.status(400).send(`Need query parameter: shop`);
        return;
    }
    const shopCollection = firestore.collection("/tea_shops");
    const query = shopCollection.where("shopName", "==", shop);
    const deletedAmount = await query.get().then(async (p) => {
        const count = p.size;
        for (const snapshot of p.docs) {
            await snapshot.ref.delete();
        }
        return count;
    });
    res.status(200).send(deletedAmount + ` ` + shop + `deleted!`);
});

export const deleteWrongShop = functions.https.onRequest(async (req, res) => {
    const shop = req.query["shop"];

    if (shop === undefined || shop === null) {
        res.status(400).send(`Need query parameter: shop`);
        return;
    }
    const shopCollection = firestore.collection("/tea_shops");
    const query = shopCollection.where("shopName", "==", shop);
    const deletedAmount = await query.get().then(async (p) => {
        const count = p.size;
        for (const snapshot of p.docs) {
            const pos = snapshot.data().position;
            if (pos === null || pos === undefined) {
                console.log(`Delete ${snapshot.data().branchName}`)
                await snapshot.ref.delete();
            }
        }
        return count;
    });
    res.status(200).send(deletedAmount + ` ` + shop + `deleted!`);
});

export const updateShopField = functions.https.onRequest(async (req, res) => {
    const shop = req.query["shop"];
    const key = req.query["key"];
    let value = req.query["value"];
    if (isNumberOnly(value)) {
        value = Number(value);
    }

    if (shop === undefined || shop === null || key === undefined || key === null) {
        res.status(400).send(`Need both query parameter: shop, key`);
        return;
    }
    const shopCollection = firestore.collection("/tea_shops");
    const query = shopCollection.where("shopName", "==", shop);
    const updatedAmount = await query.get().then(async (p) => {
        let count = 0;
        for (const snapshot of p.docs) {
            const data = snapshot.data();
            if (data.pinColor !== null && data.pinColor !== undefined) {
                continue;
            }
            count++;
            await snapshot.ref.set({ [key]: value }, { merge: true });
        }
        return count;
    });
    res.status(200).send(updatedAmount + ` ` + shop + `updated!`);
});

export const updateShopPos = functions.https.onRequest(async (req, res) => {
    const shop = req.query["shop"];
    const branch = req.query["branch"];
    let lat: any = req.query["lat"];
    if (typeof lat === "string") {
        lat = parseFloat(lat);
    }
    let lng: any = req.query["lng"];
    if (typeof lng === "string") {
        lng = parseFloat(lng);
    }

    if (shop === undefined || shop === null || branch === undefined || lat === null || lng === null) {
        res.status(400).send(`Parameters not enough`);
        return;
    }
    const shopCollection = firestore.collection("/tea_shops");
    const query = shopCollection.where("shopName", "==", shop).where("branchName", "==", branch);
    const updatedAmount = await query.get().then(async (p) => {
        const count = p.size;
        if (count > 1) {
            console.log(`More than 1 ${branch}`);
            return 0;
        }
        for (const snapshot of p.docs) {
            const hash = geohash.encode(lat, lng);
            await snapshot.ref.set({ position: { geopoint: new admin.firestore.GeoPoint(lat, lng), geohash: hash } }, { merge: true });
        }
        return count;
    });
    res.status(200).send(updatedAmount + ` ` + shop + `updated!`);
});

export const deleteShopField = functions.https.onRequest(async (req, res) => {
    const shop = req.query["shop"];
    const field = req.query["field"];

    if (shop === undefined || shop === null || field === undefined || field === null) {
        res.status(400).send(`Need both query parameter: shop, field`);
        return;
    }
    let updateData: DocumentData;
    if (field === `position`) {
        updateData = { [field]: admin.firestore.FieldValue.delete(), geohash: admin.firestore.FieldValue.delete() };
    }
    else {
        updateData = { [field]: admin.firestore.FieldValue.delete() };
    }
    const shopCollection = firestore.collection("/tea_shops");
    const query = shopCollection.where("shopName", "==", shop);
    const updatedAmount = await query.get().then(async (p) => {
        const count = p.size;
        for (const snapshot of p.docs) {
            await snapshot.ref.set(updateData, { merge: true });
        }
        return count;
    });
    res.status(200).send(updatedAmount + ` ` + shop + `updated!`);
});

export const parseShopGeocode = functions.https.onRequest(async (req, res) => {
    const shop = req.query["shop"];

    if (shop === undefined || shop === null) {
        res.status(400).send(`Need query parameter: shop`);
        return;
    }
    const shopCollection = firestore.collection("/tea_shops");
    const query = shopCollection.where("shopName", "==", shop);
    const updatedAmount = await query.get().then(async (p) => {
        //const count = p.size;
        let i = 0;
        for (const snapshot of p.docs) {
            if (i > 49) {
                break;
            }
            const data = snapshot.data();
            if (data.position !== null && data.position !== undefined) {
                continue;
            }
            i++;
            const latLng = await geocodeAddress(`${data.city}${data.district}${data.address}`);
            if (latLng === null || latLng === undefined || latLng.length !== 2) {
                console.log(`${data.branchName} parse geocode failed`)
                continue;
            }
            let lat: any = latLng[0];
            if (typeof lat === "string") {
                lat = parseFloat(lat);
            }
            let lng: any = latLng[1];
            if (typeof lng === "string") {
                lng = parseFloat(lng);
            }
            const hash = geohash.encode(lat, lng);
            await snapshot.ref.set({ position: { geopoint: new admin.firestore.GeoPoint(lat, lng), geohash: hash } }, { merge: true });
        }
        return i;
    });
    res.status(200).send(updatedAmount + ` ` + shop + `updated!`);
});

export const parseKebukeData = functions.https.onRequest(async (req, res) => {
    const parser = require('node-html-parser');
    const html = `<tbody><tr>
    <td align="center">小港<span>漢民店</span></td>
    <td align="center">高雄市小港區漢民路626號<span class="spanco"><a href="tel:07-807-0680">07-807-0680</a></span></td>
    <td align="center" valign="top"><i class="fas fa-info-circle modal_alert" data-store="103"></i></td>
    <td align="center" valign="top"><a href="https://www.google.com.tw/maps/place/%E5%8F%AF%E4%B8%8D%E5%8F%AF%E7%86%9F%E6%88%90%E7%B4%85%E8%8C%B6%EF%BC%88%E5%B0%8F%E6%B8%AF%E6%BC%A2%E6%B0%91%E5%BA%97%EF%BC%89/@22.5668758,120.3582672,17z/data=!4m13!1m7!3m6!1s0x346e1cdbf0b643e9:0x6368c22ec16d74b4!2zODEy6auY6ZuE5biC5bCP5riv5Y2A5ryi5rCR6LevNjI26Jmf!3b1!8m2!3d22.5668758!4d120.3604559!3m4!1s0x346e1cdbf0b643e9:0x57064911e720ba!8m2!3d22.5668758!4d120.3604559?hl=zh-TW" target="_blank"><i class="fas fa-map-marker-alt"></i></a></td>
  </tr>

  <tr>
    <td align="center">鳳山<span>光遠店</span></td>
    <td align="center">高雄市鳳山區光遠路280號<span class="spanco"><a href="tel:07-740-6892">07-740-6892</a></span></td>
    <td align="center" valign="top"><i class="fas fa-info-circle modal_alert" data-store="104"></i></td>
    <td align="center" valign="top"><a href="https://www.google.com.tw/maps/place/830%E9%AB%98%E9%9B%84%E5%B8%82%E9%B3%B3%E5%B1%B1%E5%8D%80%E5%85%89%E9%81%A0%E8%B7%AF280%E8%99%9F/@22.625686,120.3593323,17z/data=!3m1!4b1!4m5!3m4!1s0x346e1b3f4f8df57d:0x29d1b48273b8ebdd!8m2!3d22.625686!4d120.361521?hl=zh-TW" target="_blank"><i class="fas fa-map-marker-alt"></i></a></td>
  </tr>

  <tr>
    <td align="center">高雄<span>熱河店</span></td>
    <td align="center">高雄市三民區熱河一街343號<span class="spanco"><a href="tel:07-322-3365">07-322-3365</a></span></td>
    <td align="center" valign="top"><i class="fas fa-info-circle modal_alert" data-store="105"></i></td>
    <td align="center" valign="top"><a href="https://www.google.com.tw/maps/place/807%E9%AB%98%E9%9B%84%E5%B8%82%E4%B8%89%E6%B0%91%E5%8D%80%E7%86%B1%E6%B2%B3%E4%B8%80%E8%A1%97343%E8%99%9F/@22.643567,120.3046183,17z/data=!3m1!4b1!4m5!3m4!1s0x346e04f1bacbb957:0x771526a31e366aa9!8m2!3d22.643567!4d120.306807?hl=zh-TW" target="_blank"><i class="fas fa-map-marker-alt"></i></a></td>
  </tr>

  <tr>
    <td align="center">高雄<span>自立店</span></td>
    <td align="center">高雄市新興區自立二路118號<span class="spanco"><a href="tel:07-285-2525">07-285-2525</a></span></td>
    <td align="center" valign="top"><i class="fas fa-info-circle modal_alert" data-store="106"></i></td>
    <td align="center" valign="top"><a href="https://www.google.com.tw/maps/place/800%E9%AB%98%E9%9B%84%E5%B8%82%E6%96%B0%E8%88%88%E5%8D%80%E8%87%AA%E7%AB%8B%E4%BA%8C%E8%B7%AF118%E8%99%9F/@22.6322502,120.2964746,17z/data=!3m1!4b1!4m5!3m4!1s0x346e0489f3825381:0x6abd0426dd33ab27!8m2!3d22.6322502!4d120.2986633?hl=zh-TW" target="_blank"><i class="fas fa-map-marker-alt"></i></a></td>
  </tr>

  <tr>
    <td align="center">高雄<span>自強店</span></td>
    <td align="center">高雄市前金區自強三路254號<span class="spanco"><a href="tel:07-221-2103">07-221-2103</a></span></td>
    <td align="center" valign="top"><i class="fas fa-info-circle modal_alert" data-store="107"></i></td>
    <td align="center" valign="top"><a href="https://www.google.com.tw/maps/place/801%E9%AB%98%E9%9B%84%E5%B8%82%E5%89%8D%E9%87%91%E5%8D%80%E8%87%AA%E5%BC%B7%E4%B8%89%E8%B7%AF254%E8%99%9F/@22.6322502,120.2964746,17z/data=!4m5!3m4!1s0x346e047e277127d7:0x67566ff0f0459843!8m2!3d22.6203462!4d120.2973905?hl=zh-TW" target="_blank"><i class="fas fa-map-marker-alt"></i></a></td>
  </tr>

  <tr>
    <td align="center">高雄<span>文化店</span></td>
    <td align="center">高雄市苓雅區林泉街94號<span class="spanco"><a href="tel:07-722-8532">07-722-8532</a></span></td>
    <td align="center" valign="top"><i class="fas fa-info-circle modal_alert" data-store="108"></i></td>
    <td align="center" valign="top"><a href="https://www.google.com.tw/maps/place/802%E9%AB%98%E9%9B%84%E5%B8%82%E8%8B%93%E9%9B%85%E5%8D%80%E6%9E%97%E6%B3%89%E8%A1%9794%E8%99%9F/@22.622683,120.3146653,17z/data=!3m1!4b1!4m5!3m4!1s0x346e0499c5645c17:0xefca84a9374912f3!8m2!3d22.622683!4d120.316854?hl=zh-TW" target="_blank"><i class="fas fa-map-marker-alt"></i></a></td>
  </tr>

  <tr>
    <td align="center">高雄<span>大社店</span></td>
    <td align="center">高雄市大社區中山路216-1號<span class="spanco"><a href="tel:07-353-5748">07-353-5748</a></span></td>
    <td align="center" valign="top"><i class="fas fa-info-circle modal_alert" data-store="109"></i></td>
    <td align="center" valign="top"><a href="https://www.google.com.tw/maps/place/815%E9%AB%98%E9%9B%84%E5%B8%82%E5%A4%A7%E7%A4%BE%E5%8D%80%E4%B8%AD%E5%B1%B1%E8%B7%AF216%E8%99%9F/@22.7318334,120.3456357,17z/data=!3m1!4b1!4m5!3m4!1s0x346e102ba2901f25:0xd9fe177e768cc8b2!8m2!3d22.7318334!4d120.3478244?hl=zh-TW" target="_blank"><i class="fas fa-map-marker-alt"></i></a></td>
  </tr>

  <tr>
    <td align="center">高雄<span>文山店</span></td>
    <td align="center">高雄市鳳山區濱山街31號<span class="spanco"><a href="tel:07-777-7948">07-777-7948</a></span></td>
    <td align="center" valign="top"><i class="fas fa-info-circle modal_alert" data-store="110"></i></td>
    <td align="center" valign="top"><a href="https://www.google.com.tw/maps/place/830%E9%AB%98%E9%9B%84%E5%B8%82%E9%B3%B3%E5%B1%B1%E5%8D%80%E6%BF%B1%E5%B1%B1%E8%A1%9731%E8%99%9F/@22.6457745,120.3488809,17z/data=!3m1!4b1!4m5!3m4!1s0x346e1b29a76e12f1:0xe36cbeba63ad0417!8m2!3d22.6457745!4d120.3510696?hl=zh-TW" target="_blank"><i class="fas fa-map-marker-alt"></i></a></td>
  </tr>

  <tr>
    <td align="center">楠梓<span>德賢店</span></td>
    <td align="center">高雄市楠梓區德賢路214號<span class="spanco"><a href="tel:07-366-0360">07-366-0360</a></span></td>
    <td align="center" valign="top"><i class="fas fa-info-circle modal_alert" data-store="111"></i></td>
    <td align="center" valign="top"><a href="https://www.google.com.tw/maps/place/811%E9%AB%98%E9%9B%84%E5%B8%82%E6%A5%A0%E6%A2%93%E5%8D%80%E5%BE%B7%E8%B3%A2%E8%B7%AF214%E8%99%9F/@22.7267137,120.304141,17z/data=!3m1!4b1!4m5!3m4!1s0x346e0fa376db2335:0x185aa0a1a2df0424!8m2!3d22.7267137!4d120.3063297?hl=zh-TW" target="_blank"><i class="fas fa-map-marker-alt"></i></a></td>
  </tr>

  <tr>
    <td align="center">鳳山<span>五甲店</span></td>
    <td align="center">高雄市鳳山區自強二路115號<span class="spanco"><a href="tel:07-831-9171">07-831-9171</a></span></td>
    <td align="center" valign="top"><i class="fas fa-info-circle modal_alert" data-store="112"></i></td>
    <td align="center" valign="top"><a href="https://www.google.com.tw/maps/place/830%E9%AB%98%E9%9B%84%E5%B8%82%E9%B3%B3%E5%B1%B1%E5%8D%80%E8%87%AA%E5%BC%B7%E4%BA%8C%E8%B7%AF115%E8%99%9F/@22.5959505,120.3251258,17z/data=!3m1!4b1!4m5!3m4!1s0x346e03446b62baf3:0x483dfd4cf1d573ac!8m2!3d22.5959505!4d120.3273145?hl=zh-TW" target="_blank"><i class="fas fa-map-marker-alt"></i></a></td>
  </tr>

  <tr>
    <td align="center">左營<span>裕誠店</span></td>
    <td align="center">高雄市左營區裕誠路239號<span class="spanco"><a href="tel:07-558-5353">07-558-5353</a></span></td>
    <td align="center" valign="top"><i class="fas fa-info-circle modal_alert" data-store="127"></i></td>
    <td align="center" valign="top"><a href="https://www.google.com.tw/maps/place/813%E9%AB%98%E9%9B%84%E5%B8%82%E5%B7%A6%E7%87%9F%E5%8D%80%E8%A3%95%E8%AA%A0%E8%B7%AF239%E8%99%9F/@22.664485,120.3074233,17z/data=!3m1!4b1!4m5!3m4!1s0x346e051b3013e1c3:0xe3b588d11cec8d6e!8m2!3d22.664485!4d120.309612" target="_blank"><i class="fas fa-map-marker-alt"></i></a></td>
  </tr>

  <tr>
    <td align="center">前鎮<span>瑞隆店</span></td>
    <td align="center">高雄市前鎮區瑞隆路352號<span class="spanco"><a href="tel:07-761-7879">07-761-7879</a></span></td>
    <td align="center" valign="top"><i class="fas fa-info-circle modal_alert" data-store="128"></i></td>
    <td align="center" valign="top"><a href="https://www.google.com.tw/maps/place/806%E9%AB%98%E9%9B%84%E5%B8%82%E5%89%8D%E9%8E%AE%E5%8D%80%E7%91%9E%E9%9A%86%E8%B7%AF352%E8%99%9F/@22.6056414,120.3293102,17z/data=!3m1!4b1!4m5!3m4!1s0x346e0359e763edc7:0x4d2f50c242ce05e6!8m2!3d22.6056414!4d120.3314989" target="_blank"><i class="fas fa-map-marker-alt"></i></a></td>
  </tr>

  <tr>
    <td align="center">岡山<span>維仁店</span></td>
    <td align="center">高雄市岡山區維仁路85號<span class="spanco"><a href="tel:07-622-0377">07-622-0377</a></span></td>
    <td align="center" valign="top"><i class="fas fa-info-circle modal_alert" data-store="129"></i></td>
    <td align="center" valign="top"><a href="https://www.google.com/maps/place/820%E9%AB%98%E9%9B%84%E5%B8%82%E5%B2%A1%E5%B1%B1%E5%8D%80%E7%B6%AD%E4%BB%81%E8%B7%AF85%E8%99%9F/data=!4m2!3m1!1s0x346e0c2bdda19c81:0x52f3349eae92d802?ved=2ahUKEwi32JHbzYrhAhUPQLwKHewLD9sQ8gEwAHoECAAQAQ" target="_blank"><i class="fas fa-map-marker-alt"></i></a></td>
  </tr>
                  </tbody>`;
    const p = parser.parse(html);
    const allData: HTMLElement[] = p.querySelectorAll("tr");
    console.log("Total:" + allData.length);
    for (let i = 0; i < allData.length; i++) {
        const element = allData[i];
        let branchName;
        let phone;
        let city;
        let district;
        let originalAddress: string = "";
        let address;
        let lat: string = "";
        let lng: string = "";
        const shopName = "可不可熟成紅茶";

        const tdTags = element.querySelectorAll("td");
        let tdTag = tdTags[0];
        if (tdTag !== null) {
            //const spanTag = tdTag.querySelector("span");
            branchName = tdTag.rawText.replace("店", "");
        }
        tdTag = tdTags[1];
        if (tdTag !== null) {
            const spanTag = tdTag.querySelector("span");
            phone = spanTag.rawText;

            originalAddress = tdTag.rawText.replace(phone, "");
            const splitAddr = parseAddress(originalAddress);
            city = splitAddr[0];
            district = splitAddr[1];
            address = splitAddr[2];


        }
        tdTag = tdTags[3];
        if (tdTag !== null) {
            const url = tdTag.querySelector("a").attributes["href"];
            const capturedLatLng = url.substring(url.lastIndexOf("!3d") + 3,
                url.includes("zh-TW") ? url.lastIndexOf("?") : url.length);
            const latLng = capturedLatLng.split("!4d");
            lat = latLng[0];
            lng = latLng[1];
        }

        if (!isNumberOnly(lat) || !isNumberOnly(lng)) {
            console.log("branch: " + branchName + " 無法獲得");
            continue;
        }
        // if (i < 0) {
        console.log(shopName + "," + branchName + "," + phone + "," + city + "," + district + "," + address);
        // }

        console.log("第" + (i + 1) + "個: " + branchName + ` Lat:` + lat + `, Lng:` + lng);
        await firestore.collection("/tea_shops").add({
            shopName: shopName,
            branchName: branchName,
            city: city,
            district: district,
            address: address,
            phone: phone,
            t: lat,
            g: lng
        });
    }
    res.status(200).send("Success");
});

// export const parseChingShinData = functions.https.onRequest(async (req, res) => {
//     //Total: 504
//     //     const fetchCount = 20;
//     //     const index = 500; //Iterate this
//     const cityIndex = req.query["city"];
//     const page = req.query["page"];

//     const parser = require('node-html-parser');
//     const rp = require('request-promise');
//     const chingShinShopUrl = `http://www.chingshin.tw/store.php?city=${cityIndex}&page=${page}`; //Change city and page index
//     await rp((chingShinShopUrl)).then(async (html: string) => {
//         const p = parser.parse(html);
//         const allData: HTMLElement[] = p.querySelector("#tab-4").querySelector(".row").querySelectorAll("div");
//         allData.pop();
//         console.log("Total:" + allData.length);
//         for (let i = 0; i < allData.length; i++) {
//             const element = allData[i];
//             let branchName;
//             let phone;
//             let city;
//             let district;
//             let originalAddress: string = "";
//             let address;
//             let lat: string = "";
//             let lng: string = "";
//             const shopName = "清心福全";

//             const h3Tag = element.querySelector("h3");
//             if (h3Tag !== null) {
//                 const title = h3Tag.rawText;
//                 branchName = title.substring(title.indexOf("「") + 1, title.indexOf("」")).replace("店", "");
//             }
//             const allPData = element.querySelectorAll("p");
//             let pData = allPData[0];
//             if (pData !== null) {
//                 originalAddress = pData.rawText.trim();
//                 const splitAddr = parseAddress(originalAddress);
//                 city = splitAddr[0];
//                 district = splitAddr[1];
//                 address = splitAddr[2];
//             }
//             pData = allPData[1];
//             if (pData !== null) {
//                 let text = pData.rawText
//                 if (text.includes("（")) {
//                     text = text.substring(0, text.indexOf("（")).trim();
//                 }
//                 phone = text;
//             }

//             //const pos = await parsePositionFromGmap(originalAddress);
//             const pos = await geocodeAddress(`${city}${district}${address}`);
//             if (pos !== null && pos.length === 2) {
//                 lat = pos[0];
//                 lng = pos[1];
//             }

//             if (!isNumberOnly(lat) || !isNumberOnly(lng)) {
//                 console.log("branch: " + branchName + " 無法獲得");
//                 continue;
//             }
//             // if (i < 0) {
//             console.log(shopName + "," + branchName + "," + phone + "," + city + "," + district + "," + address);
//             // }

//             console.log("第" + (i + 1) + "個: " + branchName + ` Lat:` + lat + `, Lng:` + lng);
//             await firestore.collection("/tea_shops").add({
//                 shopName: shopName,
//                 branchName: branchName,
//                 city: city,
//                 district: district,
//                 address: address,
//                 phone: phone,
//                 t: lat,
//                 g: lng
//             });
//         }
//     });
//     res.status(200).send("Success");
// });

// export const parseTpteaData = functions.https.onRequest(async (req, res) => {
//     const tpteaData = ``; //Copy contents in <tbody> manually and paste here

//     const parser = require('node-html-parser');
//     const p = parser.parse(tpteaData);
//     const allData: HTMLElement[] = p.querySelectorAll("tr");
//     console.log("Total:" + allData.length);
//     for (let i = 0; i < allData.length; i++) {
//         const element = allData[i];
//         let branchName;
//         let phone;
//         let city;
//         let district;
//         let originalAddress: string = "";
//         let address;
//         let lat: string = "";
//         let lng: string = "";
//         const shopName = "茶湯會";

//         const allTdData = element.querySelectorAll("td");
//         let td = allTdData[0];
//         if (td !== null) {
//             branchName = td.querySelector("a").rawText.replace("店", "");
//         }
//         td = allTdData[1];
//         if (td !== null) {
//             phone = td.querySelector("a").rawText;
//         }
//         td = allTdData[2];
//         if (td !== null) {
//             const tagA = td.querySelector("a");
//             const url = tagA.attributes["href"];
//             const split = url.split("=");
//             const position = split[split.length - 1].split(",");
//             lat = position[0].replace(" ", "");
//             lng = position[1].replace(" ","");
//             originalAddress = td.rawText;
//             const splitAddr = parseAddress(originalAddress);
//             city = splitAddr[0];
//             district = splitAddr[1];
//             address = splitAddr[2];
//         }
//         if (!isNumberOnly(lat) || !isNumberOnly(lng)) {
//             console.log("branch: " + branchName + " 無法獲得");
//             continue;
//         }
//         if (i < 0) {
//             console.log(shopName + "," + branchName + "," + phone + "," + city + "," + district + "," + address);
//         }

//         console.log("第" + i + "個: " + branchName + ` Lat:` + lat + `, Lng:` + lng);
//         await firestore.collection("/tea_shops").add({
//             shopName: shopName,
//             branchName: branchName,
//             city: city,
//             district: district,
//             address: address,
//             phone: phone,
//             t: lat,
//             g: lng
//         });
//     }
//     res.status(200).send("Success");
// });

// export const parseMilkshopData = functions.https.onRequest(async (req, res) => {
//     //Total: 212
//     const fetchCount = 20;
//     const index = 200; //Change this

//     const parser = require('node-html-parser');
//     const rp = require('request-promise');
//     const milkShopUrl = "https://www.milkshoptea.com/store_detail.php?uID=22";

//     await rp((milkShopUrl)).then(async (html: string) => {
//         console.log("currentIndex:" + index);
//         const p = parser.parse(html);
//         const allData: HTMLElement[] = p.querySelectorAll(".store_box");
//         for (let i = index; i < allData.length; i++) {
//             if (i > index + fetchCount - 1) {
//                 break;
//             }
//             const element = allData[i];
//             let branchName;
//             let phone;
//             let city;
//             let district;
//             let originalAddress: string = "";
//             let address;
//             const shopName = "迷客夏";
//             const tagH3 = element.querySelector("h3");
//             if (tagH3 !== null) {
//                 tagH3.childNodes.forEach(e => {
//                     if (e instanceof TextNode) {
//                         branchName = e.rawText;
//                     }
//                 });
//             }
//             const tagP = element.querySelector("p");
//             if (tagP !== null) {
//                 tagP.childNodes.forEach(e => {
//                     if (e instanceof TextNode) {
//                         originalAddress = e.rawText.replace(" ", "");
//                         const addressInfo: string[] = parseAddress(originalAddress);
//                         city = addressInfo[0];
//                         district = addressInfo[1];
//                         address = addressInfo[2];
//                     }
//                 });
//             }
//             const tagLi = element.querySelectorAll("li");
//             if (tagLi !== null && tagLi.length === 2) {
//                 const li = tagLi[1];
//                 if (li instanceof Node) {
//                     phone = li.rawText;
//                 }
//             }

//             let lat: string = "";
//             let lng: string = "";

//             const pos = await parsePositionFromGmap(originalAddress);
//             if (pos !== null && pos.length === 2) {
//                 lat = pos[0];
//                 lng = pos[1];
//             }

//             if (!isNumberOnly(lat) || !isNumberOnly(lng)) {
//                 console.log("branch: " + branchName + " 無法獲得");
//                 continue;
//             }

//             console.log(branchName + ` Lat:` + lat + `, Lng:` + lng);
//             await firestore.collection("/tea_shops").add({
//                 shopName: shopName,
//                 branchName: branchName,
//                 city: city,
//                 district: district,
//                 address: address,
//                 phone: phone,
//                 t: lat,
//                 g: lng
//             });
//         }
//     });
//     res.status(200).send("Success");
// });


// export const parse50LanData = functions.https.onRequest(async (req, res) => {
//     //Total: 504
//     const fetchCount = 20;
//     const index = 500; //Iterate this

//     const parser = require('node-html-parser');
//     const rp = require('request-promise');
//     const _50LanShopUrl = "https://twcoupon.com/brandshop-50%E5%B5%90-%E9%9B%BB%E8%A9%B1-%E5%9C%B0%E5%9D%80.html";

//     await rp((_50LanShopUrl)).then(async (html: string) => {
//         console.log("currentIndex:" + index);
//         const p = parser.parse(html);
//         const allData: HTMLElement[] = p.querySelector(".right").querySelectorAll("li");
//         //console.log("Size:" + allData.length);

//         for (let i = index; i < allData.length; i++) {
//             if (i > index + fetchCount - 1) {
//                 break;
//             }
//             // if (i > 0) {
//             //     break;
//             // }

//             const element = allData[i];
//             let branchName;
//             let phone;
//             let city;
//             let district;
//             let originalAddress: string = "";
//             let address;
//             const shopName = "50嵐";

//             const allSpanData = element.querySelectorAll("span");
//             if (allSpanData.length !== 3) {
//                 continue;
//             }
//             const branch: HTMLElement = allSpanData[0].querySelector("a");
//             if (branch !== null) {
//                 branchName = branch.attributes["title"].split(" ")[1];
//                 // console.log("title: " + branchName);
//             }

//             const tel = allSpanData[1].querySelector("b");
//             if (tel !== null) {
//                 if (tel instanceof Node) {
//                     phone = tel.rawText;
//                     // console.log("telephone: " + phone);
//                 }
//             }

//             const addr = allSpanData[2].querySelector("b");
//             if (addr !== null) {
//                 if (addr instanceof Node) {
//                     originalAddress = addr.rawText;
//                     const splitAddr = parseAddress(addr.rawText);
//                     if (splitAddr.length === 3) {
//                         city = splitAddr[0];
//                         district = splitAddr[1];
//                         address = splitAddr[2];
//                     }
//                     // console.log("original:" + originalAddress + ", city:" + city + ", district:" + district + ", address:" + address);
//                 }
//             }

//             let lat: string = "";
//             let lng: string = "";

//             const pos = await parsePositionFromGmap(originalAddress);
//             if (pos !== null && pos.length === 2) {
//                 lat = pos[0];
//                 lng = pos[1];
//             }

//             if (!isNumberOnly(lat) || !isNumberOnly(lng)) {
//                 console.log("branch: " + branchName + " 無法獲得");
//                 continue;
//             }
//             console.log("LAT:" + lat + ", LNG:" + lng);
//             // if (i < 0) {
//             //     console.log(shopName + "," + branchName + "," + phone + "," + city + "," + district + "," + address);
//             // }
//             await firestore.collection("/tea_shops").add({
//                 shopName: shopName,
//                 branchName: branchName,
//                 city: city,
//                 district: district,
//                 address: address,
//                 phone: phone,
//                 t: lat,
//                 g: lng
//             });
//         }
//     });
//     res.status(200).send("Success");
// });

// export const parseDaYungsData = functions.https.onRequest(async (req, res) => {
//     //Total: 504
//     //const fetchCount = 20;
//     //const index = 500; //Iterate this


//     const daYungsData = ""; //See da_yungs_data.ts

//     const parser = require('node-html-parser');
//     const data = parser.parse(daYungsData);
//     const allData: HTMLElement[] = data.querySelectorAll("tr");
//     //console.log("Size:" + allData.length);

//     for (let i = 0; i < allData.length; i++) {
//         if (i < 0) {
//             break;
//         }

//         const element = allData[i];
//         let branchName;
//         let phone;
//         let city;
//         let district;
//         let originalAddress: string = ``;
//         let address;
//         let lat;
//         let lng;
//         const shopName = `大苑子`;

//         const allTdData = element.querySelectorAll("td");

//         let td = allTdData[0];
//         if (td instanceof Node) {
//             branchName = td.rawText.replace("店", "");
//         }
//         td = allTdData[1];
//         if (td instanceof Node) {
//             phone = td.rawText;
//         }
//         td = allTdData[3];
//         if (td instanceof Node) {
//             originalAddress = td.rawText;
//             const result = parseAddress(originalAddress);
//             city = result[0];
//             district = result[1];
//             address = result[2];
//         }
//         td = allTdData[4];
//         const aTag = td.querySelector("a");
//         const url = aTag.attributes["href"];
//         const split = url.split("/");
//         const position = split[split.length - 1].split(",");
//         lat = position[0];
//         lng = position[1];

//         // if(i<0){
//         //     console.log(shopName + "," + branchName + "," + phone + "," + city + "," + district + "," + address + "," + lat + "," + lng);
//         // }

//         await firestore.collection("/tea_shops").add({
//             shopName: shopName,
//             branchName: branchName,
//             city: city,
//             district: district,
//             address: address,
//             phone: phone,
//             t: lat,
//             g: lng
//         });
//     }

//     res.status(200).send("Success");
// });




//Return [city, district, address]
function parseAddress(address: any): string[] {
    let cityIndex: number;
    let districtIndex: number;

    if (address.includes(`市`) && address.includes(`區`)) {
        cityIndex = address.indexOf(`市`);
        districtIndex = address.indexOf(`區`, cityIndex);
    }
    else {
        cityIndex = address.indexOf(`縣`);
        const districtIndexArr: number[] = [address.indexOf(`鄉`), address.indexOf(`鎮`), address.indexOf(`市`)];
        districtIndexArr.sort();
        const last = districtIndexArr.pop();
        districtIndex = last === undefined ? -1 : last;
    }
    let city: string = address.substring(0, cityIndex + 1);
    if (containsNumber(city)) {
        let startIndex = 0;
        while (containsNumber(address.charAt(startIndex))) {
            startIndex++;
        }
        city = address.substring(startIndex, city.length);
    }
    const district: string = address.substring(cityIndex + 1, districtIndex + 1);
    const newAddress: string = address.substring(districtIndex + 1);
    return [city, district, newAddress];
}

// async function parsePositionFromGmap(address: string): Promise<string[]> {
//     const mapUrlPrefix = "https://www.google.com.tw/maps/place/";
//     const rp = require('request-promise');

//     return rp(mapUrlPrefix + encodeURIComponent(address)).then((data: string) => {
//         const position = parseGeoPosition(data, address);
//         // console.log("Position:" + position);
//         return position === null || position.length !== 2 ? [] : position;

//     }).catch((err: any) => { console.log(err); });

//     //Return [latitude, longitude]
//     function parseGeoPosition(data: string, originalAddress: string): string[] | null {
//         const startIndex = data.indexOf(originalAddress);
//         if (startIndex < 0) {
//             return null;
//         }
//         const leftBracketPos = data.indexOf("[", startIndex);
//         const rightBracketPos = data.indexOf("]", leftBracketPos);
//         const str = data.substring(leftBracketPos + 1, rightBracketPos);
//         const split = str.split(",");
//         const parsedPosition: string[] = [];
//         for (const element of split) {
//             if (isNumberOnly(element)) {
//                 parsedPosition.push(element);
//             }
//             if (parsedPosition.length === 2) {
//                 break;
//             }
//         }
//         return parsedPosition;
//     }
// }

async function geocodeAddress(address: string) {
    const googleMapsClient = geocode.createClient({
        key: 'AIzaSyAejNrfQBqK45EVlhOdpDrUirNu-O3WxXg',
        Promise: Promise
    });
    return googleMapsClient.geocode({
        address: address, region: `tw`, language: `zh-TW`
    }).asPromise()
        .then((response) => {
            const geometry = response.json.results[0].geometry
            const location = geometry.location;
            const formattedAddress = response.json.results[0].formatted_address;
            const isTheSame = formattedAddress.includes(address);
            console.log(`Original address: ${address}`)
            console.log(`FormattedAddress: ${formattedAddress}`);
            console.log(`Both the same: ${isTheSame}`);
            return isTheSame ? [location.lat.toString(), location.lng.toString()] : [];
        })
        .catch((err) => {
            console.log(err);
            return [];
        });
}

function containsNumber(str: string) {
    return /\d/.test(str);
}

function isNumberOnly(str: string) {
    return /^\d+(\.\d+)?$/.test(str);
}
import {type Page} from '@playwright/test';
export async function openWorkspace(page:Page,name:string){
 const menuToggle=page.getByRole('button',{name:'Menu',exact:true});
 if(await menuToggle.isVisible() && await menuToggle.getAttribute('aria-expanded')==='false')await menuToggle.click();
 const button=page.locator('#workspace-menu').getByRole('button',{name,exact:true,includeHidden:true});
 if(!await button.isVisible())await button.locator('xpath=ancestor::section').getByRole('button',{expanded:false}).click();
 await button.click();
}
export async function chooseReference(page:Page,label:string,value:string){
 const control=page.getByLabel(label,{exact:true});
 if(await control.evaluate(el=>el.tagName==='SELECT')){await control.selectOption(value);return;}
 await control.click();
 await control.locator('xpath=ancestor::div[contains(@class,"search-select")]').locator(`[role=option][data-value="${value}"]`).click();
}

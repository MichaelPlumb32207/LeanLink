export interface FreePassSteps {
  household: boolean;
  fl_contrib_l1: boolean;
  sunbiz: boolean;
  fl_contrib_l2: boolean;
}

export const FREE_PASS_ALL: FreePassSteps = {
  household: true,
  fl_contrib_l1: true,
  sunbiz: true,
  fl_contrib_l2: true,
};

export const FREE_PASS_FL_CONTRIB: FreePassSteps = {
  household: true,
  fl_contrib_l1: true,
  sunbiz: false,
  fl_contrib_l2: false,
};

export const FREE_PASS_SUNBIZ_ENTITY: FreePassSteps = {
  household: false,
  fl_contrib_l1: false,
  sunbiz: true,
  fl_contrib_l2: true,
};
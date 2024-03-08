class Solution {
    public boolean isSubsequence(String s, String t) {
        char[] arrayS = s.toCharArray(),
             arrayT = t.toCharArray();

        int i = 0, j = 0;
        while (i < arrayS.length && j < arrayT.length) {
            if (arrayS[i] == arrayT[j])
                i++;
            j++;
        }

        return i == arrayS.length;
    }
}